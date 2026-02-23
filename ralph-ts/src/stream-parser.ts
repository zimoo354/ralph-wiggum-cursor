/**
 * Ralph Wiggum: Stream Parser
 * Parses cursor-agent stream-json output; tracks token usage; emits signals; writes .ralph logs.
 * Mirrors scripts/stream-parser.sh behavior.
 */

import * as fs from "fs";
import * as path from "path";
import { getRalphDir, WARN_THRESHOLD, ROTATE_THRESHOLD } from "./ralph-common.js";

export type ParserSignal = "ROTATE" | "WARN" | "GUTTER" | "COMPLETE" | "DEFER";

export interface TokenUsage {
  bytesRead: number;
  bytesWritten: number;
  assistantChars: number;
  shellOutputChars: number;
  promptChars: number;
  toolCalls: number;
}

function getHealthEmoji(tokens: number): string {
  const pct = Math.floor((tokens * 100) / ROTATE_THRESHOLD);
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

export interface StreamParserOptions {
  workspace: string;
  onSignal?: (signal: ParserSignal) => void;
}

export class StreamParser {
  private workspace: string;
  private ralphDir: string;
  private usage: TokenUsage = {
    bytesRead: 0,
    bytesWritten: 0,
    assistantChars: 0,
    shellOutputChars: 0,
    promptChars: 3000,
    toolCalls: 0,
  };
  private warnSent = false;
  private onSignal?: (signal: ParserSignal) => void;
  private shellFailures = new Map<string, number>();
  private fileWrites: { time: number; path: string }[] = [];

  constructor(options: StreamParserOptions) {
    this.workspace = path.resolve(options.workspace);
    this.ralphDir = getRalphDir(this.workspace);
    this.onSignal = options.onSignal;
  }

  getTokenUsage(): TokenUsage {
    return { ...this.usage };
  }

  /** Approximate token count (chars/4). */
  calcTokens(): number {
    const total =
      this.usage.promptChars +
      this.usage.bytesRead +
      this.usage.bytesWritten +
      this.usage.assistantChars +
      this.usage.shellOutputChars;
    return Math.floor(total / 4);
  }

  private logActivity(message: string): void {
    const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    const tokens = this.calcTokens();
    const emoji = getHealthEmoji(tokens);
    const line = `[${timestamp}] ${emoji} ${message}\n`;
    fs.appendFileSync(path.join(this.ralphDir, "activity.log"), line, "utf8");
  }

  private logError(message: string): void {
    const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    const line = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(path.join(this.ralphDir, "errors.log"), line, "utf8");
  }

  private checkGutter(): void {
    const tokens = this.calcTokens();
    if (tokens >= ROTATE_THRESHOLD) {
      this.logActivity(`ROTATE: Token threshold reached (${tokens} >= ${ROTATE_THRESHOLD})`);
      this.onSignal?.("ROTATE");
      return;
    }
    if (tokens >= WARN_THRESHOLD && !this.warnSent) {
      this.warnSent = true;
      this.logActivity(`WARN: Approaching token limit (${tokens} >= ${WARN_THRESHOLD})`);
      this.onSignal?.("WARN");
    }
  }

  private trackShellFailure(cmd: string, exitCode: number): void {
    if (exitCode === 0) return;
    const count = (this.shellFailures.get(cmd) ?? 0) + 1;
    this.shellFailures.set(cmd, count);
    this.logError(`SHELL FAIL: ${cmd} → exit ${exitCode} (attempt ${count})`);
    if (count >= 3) {
      this.logError(`⚠️ GUTTER: same command failed ${count}x`);
      this.onSignal?.("GUTTER");
    }
  }

  private trackFileWrite(filePath: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.fileWrites.push({ time: now, path: filePath });
    const cutoff = now - 600;
    const recent = this.fileWrites.filter((w) => w.time >= cutoff && w.path === filePath);
    if (recent.length >= 5) {
      this.logError(`⚠️ THRASHING: ${filePath} written ${recent.length}x in 10 min`);
      this.onSignal?.("GUTTER");
    }
  }

  /** Write session start banner to activity.log. */
  startSession(): void {
    const lines = [
      "",
      "═══════════════════════════════════════════════════════════════",
      `Ralph Session Started: ${new Date().toISOString()}`,
      "═══════════════════════════════════════════════════════════════",
      "",
    ];
    fs.appendFileSync(path.join(this.ralphDir, "activity.log"), lines.join("\n") + "\n", "utf8");
  }

  /** Process a single JSON line from stream-json. Returns emitted signal if any. */
  processLine(line: string): ParserSignal | undefined {
    line = line.trim();
    if (!line) return undefined;

    let obj: unknown;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return undefined;
    }

    const type = (obj as Record<string, unknown>).type as string | undefined;
    const subtype = (obj as Record<string, unknown>).subtype as string | undefined;

    switch (type) {
      case "system":
        if (subtype === "init") {
          const model = ((obj as Record<string, unknown>).model as string) ?? "unknown";
          this.logActivity(`SESSION START: model=${model}`);
        }
        break;

      case "error": {
        const err = obj as Record<string, unknown>;
        const data = err.error as Record<string, unknown> | undefined;
        const dataMsg = data?.data as Record<string, unknown> | undefined;
        const message =
          (dataMsg?.message as string) ??
          (data?.message as string) ??
          (err.message as string) ??
          "Unknown error";
        this.logError(`API ERROR: ${message}`);
        this.logActivity(`❌ API ERROR: ${message}`);
        if (isRetryableApiError(message)) {
          this.logError("⚠️ RETRYABLE: Error may be transient (rate limit/network)");
          this.onSignal?.("DEFER");
          return "DEFER";
        }
        this.logError("🚨 NON-RETRYABLE: Error requires attention");
        this.onSignal?.("GUTTER");
        return "GUTTER";
      }

      case "assistant": {
        const msg = (obj as Record<string, unknown>).message as Record<string, unknown> | undefined;
        const content = msg?.content as unknown[] | undefined;
        const first = content?.[0] as Record<string, unknown> | undefined;
        const text = (first?.text as string) ?? "";
        if (text) {
          this.usage.assistantChars += text.length;
          if (text.includes("<ralph>COMPLETE</ralph>")) {
            this.logActivity("✅ Agent signaled COMPLETE");
            this.onSignal?.("COMPLETE");
            return "COMPLETE";
          }
          if (text.includes("<ralph>GUTTER</ralph>")) {
            this.logActivity("🚨 Agent signaled GUTTER (stuck)");
            this.onSignal?.("GUTTER");
            return "GUTTER";
          }
        }
        break;
      }

      case "tool_call":
        if (subtype === "started") {
          this.usage.toolCalls += 1;
        } else if (subtype === "completed") {
          const tc = (obj as Record<string, unknown>).tool_call as Record<string, unknown> | undefined;
          if (!tc) break;

          if (tc.readToolCall) {
            const r = tc.readToolCall as Record<string, unknown>;
            const result = r.result as Record<string, unknown> | undefined;
            const success = result?.success as Record<string, unknown> | undefined;
            if (success) {
              const args = r.args as Record<string, unknown> | undefined;
              const p = (args?.path as string) ?? "unknown";
              const lines = (success.totalLines as number) ?? 0;
              let bytes = (success.contentSize as number) ?? 0;
              if (bytes <= 0) bytes = lines * 100;
              this.usage.bytesRead += bytes;
              const kb = (bytes / 1024).toFixed(1);
              this.logActivity(`READ ${p} (${lines} lines, ~${kb}KB)`);
            }
          }

          if (tc.writeToolCall) {
            const w = tc.writeToolCall as Record<string, unknown>;
            const result = w.result as Record<string, unknown> | undefined;
            const success = result?.success as Record<string, unknown> | undefined;
            if (success) {
              const args = w.args as Record<string, unknown> | undefined;
              const p = (args?.path as string) ?? "unknown";
              const bytes = (success.fileSize as number) ?? 0;
              this.usage.bytesWritten += bytes;
              const kb = (bytes / 1024).toFixed(1);
              this.logActivity(`WRITE ${p} (${(success.linesCreated as number) ?? 0} lines, ${kb}KB)`);
              this.trackFileWrite(p);
            }
          }

          if (tc.shellToolCall) {
            const s = tc.shellToolCall as Record<string, unknown>;
            const args = s.args as Record<string, unknown> | undefined;
            const cmd = (args?.command as string) ?? "unknown";
            const result = s.result as Record<string, unknown> | undefined;
            const exitCode = (result?.exitCode as number) ?? 0;
            const stdout = (result?.stdout as string) ?? "";
            const stderr = (result?.stderr as string) ?? "";
            const outputChars = stdout.length + stderr.length;
            this.usage.shellOutputChars += outputChars;
            if (exitCode === 0) {
              if (outputChars > 1024) {
                this.logActivity(`SHELL ${cmd} → exit 0 (${outputChars} chars output)`);
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
        const duration = (obj as Record<string, unknown>).duration_ms as number | undefined;
        const tokens = this.calcTokens();
        this.logActivity(`SESSION END: ${duration ?? 0}ms, ~${tokens} tokens used`);
        break;
      }
    }
    return undefined;
  }

  /** Log current token status to activity.log. */
  logTokenStatus(): void {
    const tokens = this.calcTokens();
    const pct = Math.floor((tokens * 100) / ROTATE_THRESHOLD);
    const emoji = getHealthEmoji(tokens);
    let statusMsg = `TOKENS: ${tokens} / ${ROTATE_THRESHOLD} (${pct})%`;
    if (pct >= 90) statusMsg += " - rotation imminent";
    else if (pct >= 72) statusMsg += " - approaching limit";
    const breakdown = `[read:${Math.floor(this.usage.bytesRead / 1024)}KB write:${Math.floor(this.usage.bytesWritten / 1024)}KB assist:${Math.floor(this.usage.assistantChars / 1024)}KB shell:${Math.floor(this.usage.shellOutputChars / 1024)}KB]`;
    const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    const line = `[${timestamp}] ${emoji} ${statusMsg} ${breakdown}\n`;
    fs.appendFileSync(path.join(this.ralphDir, "activity.log"), line, "utf8");
  }
}
