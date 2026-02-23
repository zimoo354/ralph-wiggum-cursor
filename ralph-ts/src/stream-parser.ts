/**
 * Ralph Wiggum: Stream Parser
 * Parses cursor-agent stream-json output; tracks token usage; emits signals.
 * Mirrors scripts/stream-parser.sh behavior.
 */

import * as fs from "fs";
import * as path from "path";
import { getRalphDir, WARN_THRESHOLD, ROTATE_THRESHOLD } from "./ralph-common.js";

export type ParserSignal = "ROTATE" | "WARN" | "GUTTER" | "COMPLETE" | "DEFER";

export interface StreamParserOptions {
  workspace: string;
  onSignal?: (signal: ParserSignal) => void;
}

/** Token usage by category (bytes/chars) */
export interface TokenUsage {
  promptChars: number;
  bytesRead: number;
  bytesWritten: number;
  assistantChars: number;
  shellOutputChars: number;
}

/** Estimate tokens from bytes (rough: ~4 chars per token) */
export function estimateTokens(usage: TokenUsage): number {
  const total =
    usage.promptChars +
    usage.bytesRead +
    usage.bytesWritten +
    usage.assistantChars +
    usage.shellOutputChars;
  return Math.floor(total / 4);
}

function getHealthEmoji(tokens: number): string {
  const pct = (tokens * 100) / ROTATE_THRESHOLD;
  if (pct < 60) return "🟢";
  if (pct < 80) return "🟡";
  return "🔴";
}

function isRetryableApiError(message: string): boolean {
  const lower = message.toLowerCase();
  const patterns = [
    /rate\s*limit|rate_limit|rate-limit/,
    /quota\s*exceeded|quota\s*limit|hit\s*your\s*limit/,
    /too\s*many\s*requests|429|http\s*429/,
    /timeout|timed\s*out|connection\s*timeout/,
    /network\s*error|network\s*unavailable/,
    /connection\s*refused|connection\s*reset|econnreset/,
    /connection\s*closed|connection\s*failed|etimedout|enotfound/,
    /service\s*unavailable|503/,
    /bad\s*gateway|502/,
    /gateway\s*timeout|504/,
    /overloaded|server\s*busy|try\s*again/,
  ];
  return patterns.some((p) => p.test(lower));
}

export class StreamParser {
  private workspace: string;
  private onSignal?: (signal: ParserSignal) => void;
  private usage: TokenUsage = {
    promptChars: 3000,
    bytesRead: 0,
    bytesWritten: 0,
    assistantChars: 0,
    shellOutputChars: 0,
  };
  private warnSent = false;
  private shellFailures = new Map<string, number>();
  private fileWrites: { time: number; path: string }[] = [];
  private lastTokenLogTime = 0;

  constructor(options: StreamParserOptions) {
    this.workspace = options.workspace;
    this.onSignal = options.onSignal;
    const ralphDir = getRalphDir(options.workspace);
    if (!fs.existsSync(ralphDir)) fs.mkdirSync(ralphDir, { recursive: true });
  }

  private logActivity(message: string): void {
    const ralphDir = getRalphDir(this.workspace);
    const activityPath = path.join(ralphDir, "activity.log");
    const timestamp = new Date().toLocaleTimeString("en-GB", { hour12: false });
    const tokens = estimateTokens(this.usage);
    const emoji = getHealthEmoji(tokens);
    fs.appendFileSync(activityPath, `[${timestamp}] ${emoji} ${message}\n`, "utf8");
  }

  private logError(message: string): void {
    const ralphDir = getRalphDir(this.workspace);
    const errorsPath = path.join(ralphDir, "errors.log");
    const timestamp = new Date().toLocaleTimeString("en-GB", { hour12: false });
    fs.appendFileSync(errorsPath, `[${timestamp}] ${message}\n`, "utf8");
  }

  private logTokenStatus(): void {
    const tokens = estimateTokens(this.usage);
    const pct = (tokens * 100) / ROTATE_THRESHOLD;
    const emoji = getHealthEmoji(tokens);
    const timestamp = new Date().toLocaleTimeString("en-GB", { hour12: false });
    let statusMsg = `TOKENS: ${tokens} / ${ROTATE_THRESHOLD} (${pct}%)`;
    if (pct >= 90) statusMsg += " - rotation imminent";
    else if (pct >= 72) statusMsg += " - approaching limit";
    const breakdown = `[read:${Math.floor(this.usage.bytesRead / 1024)}KB write:${Math.floor(this.usage.bytesWritten / 1024)}KB assist:${Math.floor(this.usage.assistantChars / 1024)}KB shell:${Math.floor(this.usage.shellOutputChars / 1024)}KB]`;
    const ralphDir = getRalphDir(this.workspace);
    fs.appendFileSync(
      path.join(ralphDir, "activity.log"),
      `[${timestamp}] ${emoji} ${statusMsg} ${breakdown}\n`,
      "utf8"
    );
  }

  private checkGutter(): void {
    const tokens = estimateTokens(this.usage);
    if (tokens >= ROTATE_THRESHOLD) {
      this.logActivity(`ROTATE: Token threshold reached (${tokens} >= ${ROTATE_THRESHOLD})`);
      this.emit("ROTATE");
      return;
    }
    if (tokens >= WARN_THRESHOLD && !this.warnSent) {
      this.logActivity(`WARN: Approaching token limit (${tokens} >= ${WARN_THRESHOLD})`);
      this.warnSent = true;
      this.emit("WARN");
    }
  }

  private trackShellFailure(cmd: string, exitCode: number): void {
    if (exitCode === 0) return;
    const count = (this.shellFailures.get(cmd) ?? 0) + 1;
    this.shellFailures.set(cmd, count);
    this.logError(`SHELL FAIL: ${cmd} → exit ${exitCode} (attempt ${count})`);
    if (count >= 3) {
      this.logError(`⚠️ GUTTER: same command failed ${count}x`);
      this.emit("GUTTER");
    }
  }

  private trackFileWrite(filePath: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.fileWrites.push({ time: now, path: filePath });
    const cutoff = now - 600;
    const count = this.fileWrites.filter((w) => w.time >= cutoff && w.path === filePath).length;
    if (count >= 5) {
      this.logError(`⚠️ THRASHING: ${filePath} written ${count}x in 10 min`);
      this.emit("GUTTER");
    }
  }

  private emit(signal: ParserSignal): void {
    this.onSignal?.(signal);
  }

  /** Process a single JSON line from stream-json output */
  processLine(line: string): void {
    line = line.trim();
    if (!line) return;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = (obj.type as string) ?? "";
    const subtype = (obj.subtype as string) ?? "";

    switch (type) {
      case "system":
        if (subtype === "init") {
          const model = (obj.model as string) ?? "unknown";
          this.logActivity(`SESSION START: model=${model}`);
        }
        break;

      case "error": {
        const err = obj.error as Record<string, unknown> | undefined;
        const data = err?.data as Record<string, unknown> | undefined;
        const message =
          (data?.message as string) ??
          (err?.message as string) ??
          (obj.message as string) ??
          "Unknown error";
        this.logError(`API ERROR: ${message}`);
        this.logActivity(`❌ API ERROR: ${message}`);
        if (isRetryableApiError(message)) {
          this.logError("⚠️ RETRYABLE: Error may be transient (rate limit/network)");
          this.emit("DEFER");
        } else {
          this.logError("🚨 NON-RETRYABLE: Error requires attention");
          this.emit("GUTTER");
        }
        break;
      }

      case "assistant": {
        const message = obj.message as Record<string, unknown> | undefined;
        const content = message?.content as unknown[] | undefined;
        const first = content?.[0] as Record<string, unknown> | undefined;
        const text = (first?.text as string) ?? "";
        if (text) {
          this.usage.assistantChars += text.length;
          if (text.includes("<ralph>COMPLETE</ralph>")) {
            this.logActivity("✅ Agent signaled COMPLETE");
            this.emit("COMPLETE");
          }
          if (text.includes("<ralph>GUTTER</ralph>")) {
            this.logActivity("🚨 Agent signaled GUTTER (stuck)");
            this.emit("GUTTER");
          }
        }
        break;
      }

      case "tool_call":
        if (subtype === "completed") {
          const toolCall = obj.tool_call as Record<string, unknown> | undefined;
          if (!toolCall) break;

          const readResult = (toolCall.readToolCall as Record<string, unknown>)?.result as Record<string, unknown> | undefined;
          if (readResult?.success) {
            const args = (toolCall.readToolCall as Record<string, unknown>).args as Record<string, unknown>;
            const res = readResult.success as Record<string, unknown>;
            const pathArg = (args?.path as string) ?? "unknown";
            const lines = (res.totalLines as number) ?? 0;
            const contentSize = (res.contentSize as number) ?? 0;
            const bytes = contentSize > 0 ? contentSize : lines * 100;
            this.usage.bytesRead += bytes;
            const kb = (bytes / 1024).toFixed(1);
            this.logActivity(`READ ${pathArg} (${lines} lines, ~${kb}KB)`);
          }

          const writeResult = (toolCall.writeToolCall as Record<string, unknown>)?.result as Record<string, unknown> | undefined;
          if (writeResult?.success) {
            const args = (toolCall.writeToolCall as Record<string, unknown>).args as Record<string, unknown>;
            const res = writeResult.success as Record<string, unknown>;
            const pathArg = (args?.path as string) ?? "unknown";
            const bytes = (res.fileSize as number) ?? 0;
            const lines = (res.linesCreated as number) ?? 0;
            this.usage.bytesWritten += bytes;
            const kb = (bytes / 1024).toFixed(1);
            this.logActivity(`WRITE ${pathArg} (${lines} lines, ${kb}KB)`);
            this.trackFileWrite(pathArg);
          }

          const shellCall = toolCall.shellToolCall as Record<string, unknown> | undefined;
          const shellResult = shellCall?.result;
          if (shellResult != null && shellCall) {
            const args = shellCall.args as Record<string, unknown> | undefined;
            const res = shellResult as Record<string, unknown>;
            const cmd = (args?.command as string) ?? "unknown";
            const exitCode = (res.exitCode as number) ?? 0;
            const stdout = (res.stdout as string) ?? "";
            const stderr = (res.stderr as string) ?? "";
            this.usage.shellOutputChars += stdout.length + stderr.length;
            if (exitCode === 0) {
              if (stdout.length + stderr.length > 1024) {
                this.logActivity(`SHELL ${cmd} → exit 0 (${stdout.length + stderr.length} chars output)`);
              } else {
                this.logActivity(`SHELL ${cmd} → exit 0`);
              }
            } else {
              this.logActivity(`SHELL ${cmd} → exit ${exitCode}`);
              this.trackShellFailure(cmd, exitCode);
            }
          }

          this.checkGutter();
        }
        break;

      case "result": {
        const duration = (obj.duration_ms as number) ?? 0;
        const tokens = estimateTokens(this.usage);
        this.logActivity(`SESSION END: ${duration}ms, ~${tokens} tokens used`);
        break;
      }
    }
  }

  /** Write session header to activity.log and optionally log token status every 30s */
  startSession(): void {
    const ralphDir = getRalphDir(this.workspace);
    const activityPath = path.join(ralphDir, "activity.log");
    const header = [
      "",
      "═══════════════════════════════════════════════════════════════",
      `Ralph Session Started: ${new Date().toISOString()}`,
      "═══════════════════════════════════════════════════════════════",
      "",
    ].join("\n");
    fs.appendFileSync(activityPath, header, "utf8");
    this.lastTokenLogTime = Math.floor(Date.now() / 1000);
  }

  maybeLogTokenStatus(): void {
    const now = Math.floor(Date.now() / 1000);
    if (now - this.lastTokenLogTime >= 30) {
      this.logTokenStatus();
      this.lastTokenLogTime = now;
    }
  }

  endSession(): void {
    this.logTokenStatus();
  }

  getUsage(): TokenUsage {
    return { ...this.usage };
  }
}
