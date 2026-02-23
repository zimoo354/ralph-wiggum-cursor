/**
 * Ralph Wiggum: Run Loop
 * Spawns cursor-agent, pipes stdout through stream parser, handles signals and iterations.
 * Mirrors scripts/ralph-loop.sh and scripts/ralph-common.sh run_iteration/run_ralph_loop.
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { getRalphDir, initRalphDir, MAX_ITERATIONS, DEFAULT_MODEL } from "./ralph-common.js";
import { StreamParser, type ParserSignal } from "./stream-parser.js";
import {
  isTaskComplete,
  countRemaining,
} from "./task-parser.js";

export function buildPrompt(iteration: number): string {
  return `# Ralph Iteration ${iteration}

You are an autonomous development agent using the Ralph methodology.

## FIRST: Read State Files

Before doing anything:
1. Read \`RALPH_TASK.md\` - your task and completion criteria
2. Read \`.ralph/guardrails.md\` - lessons from past failures (FOLLOW THESE)
3. Read \`.ralph/progress.md\` - what's been accomplished
4. Read \`.ralph/errors.log\` - recent failures to avoid

## Working Directory (Critical)

You are already in a git repository. Work HERE, not in a subdirectory:

- Do NOT run \`git init\` - the repo already exists
- Do NOT run scaffolding commands that create nested directories (\`npx create-*\`, \`pnpm init\`, etc.)
- If you need to scaffold, use flags like \`--no-git\` or scaffold into the current directory (\`.\`)
- All code should live at the repo root or in subdirectories you create manually

## Git Protocol (Critical)

Ralph's strength is state-in-git, not LLM memory. Commit early and often:

1. After completing each criterion, commit your changes:
   \`git add -A && git commit -m 'ralph: implement state tracker'\`
   \`git add -A && git commit -m 'ralph: fix async race condition'\`
   \`git add -A && git commit -m 'ralph: add CLI adapter with commander'\`
   Always describe what you actually did - never use placeholders like '<description>'
2. After any significant code change (even partial): commit with descriptive message
3. Before any risky refactor: commit current state as checkpoint
4. Push after every 2-3 commits: \`git push\`

If you get rotated, the next agent picks up from your last commit. Your commits ARE your memory.

## Task Execution

1. Work on the next unchecked criterion in RALPH_TASK.md (look for \`[ ]\`)
2. Run tests after changes (check RALPH_TASK.md for test_command)
3. **Mark completed criteria**: Edit RALPH_TASK.md and change \`[ ]\` to \`[x]\`
   - Example: \`- [ ] Implement parser\` becomes \`- [x] Implement parser\`
   - This is how progress is tracked - YOU MUST update the file
4. Update \`.ralph/progress.md\` with what you accomplished
5. When ALL criteria show \`[x]\`: output \`<ralph>COMPLETE</ralph>\`
6. If stuck 3+ times on same issue: output \`<ralph>GUTTER</ralph>\`

## Learning from Failures

When something fails:
1. Check \`.ralph/errors.log\` for failure history
2. Figure out the root cause
3. Add a Sign to \`.ralph/guardrails.md\` using this format:

\`\`\`
### Sign: [Descriptive Name]
- **Trigger**: When this situation occurs
- **Instruction**: What to do instead
- **Added after**: Iteration ${iteration} - what happened
\`\`\`

## Context Rotation Warning

You may receive a warning that context is running low. When you see it:
1. Finish your current file edit
2. Commit and push your changes
3. Update .ralph/progress.md with what you accomplished and what's next
4. You will be rotated to a fresh agent that continues your work

Begin by reading the state files.
`;
}

export interface RunLoopOptions {
  workspace: string;
  maxIterations?: number;
  model?: string;
  singleRun?: boolean;
}

export interface RunIterationResult {
  signal: ParserSignal | null;
  exitCode: number | null;
}

/**
 * Run a single agent iteration: spawn cursor-agent, pipe stdout through stream parser, return signal.
 */
export async function runIteration(
  workspace: string,
  iteration: number,
  options: { model?: string; sessionId?: string } = {}
): Promise<RunIterationResult> {
  const model = options.model ?? DEFAULT_MODEL;
  const prompt = buildPrompt(iteration);

  let lastSignal: ParserSignal | null = null;
  const parser = new StreamParser({
    workspace,
    onSignal(sig) {
      lastSignal = sig;
    },
  });
  parser.startSession();

  const args = [
    "-p",
    "--force",
    "--output-format",
    "stream-json",
    "--model",
    model,
  ];
  if (options.sessionId) args.push("--resume", options.sessionId);
  args.push(prompt);

  const agent = spawn("cursor-agent", args, {
    cwd: workspace,
    stdio: ["pipe", "pipe", "inherit"],
  });

  let buffer = "";
  agent.stdout.setEncoding("utf8");
  agent.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      parser.processLine(line);
    }
  });

  const exitCode = await new Promise<number | null>((resolve) => {
    agent.on("exit", (code) => resolve(code ?? null));
  });

  if (buffer) parser.processLine(buffer);
  parser.logTokenStatus();

  return { signal: lastSignal, exitCode };
}

function logProgress(workspace: string, message: string): void {
  const progressPath = path.join(getRalphDir(workspace), "progress.md");
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const line = `\n### ${timestamp}\n${message}\n`;
  fs.appendFileSync(progressPath, line, "utf8");
}

/**
 * Run the main loop: up to maxIterations, handle ROTATE/COMPLETE/GUTTER/DEFER.
 */
export async function runRalphLoop(options: RunLoopOptions): Promise<number> {
  const workspace = path.resolve(options.workspace);
  const maxIterations = options.maxIterations ?? MAX_ITERATIONS;
  const model = options.model ?? DEFAULT_MODEL;
  const singleRun = options.singleRun ?? false;

  const taskFile = path.join(workspace, "RALPH_TASK.md");
  if (!fs.existsSync(taskFile)) {
    console.error(`❌ No RALPH_TASK.md found in ${workspace}`);
    return 1;
  }

  initRalphDir(workspace);

  let iteration = 1;
  let sessionId: string | undefined;

  while (iteration <= maxIterations) {
    console.log("");
    console.log("═══════════════════════════════════════════════════════════════════");
    console.log(`🐛 Ralph Iteration ${iteration}`);
    console.log("═══════════════════════════════════════════════════════════════════");
    console.log("");
    console.log(`Workspace: ${workspace}`);
    console.log(`Model:     ${model}`);
    console.log(`Monitor:   tail -f ${path.join(workspace, ".ralph", "activity.log")}`);
    console.log("");

    logProgress(workspace, `**Session ${iteration} started** (model: ${model})`);

    const { signal } = await runIteration(workspace, iteration, { model, sessionId });

    const taskComplete = isTaskComplete(workspace);

    if (taskComplete) {
      logProgress(workspace, "**Session ended** - ✅ TASK COMPLETE");
      console.log("");
      console.log("═══════════════════════════════════════════════════════════════════");
      console.log("🎉 RALPH COMPLETE! All criteria satisfied.");
      console.log("═══════════════════════════════════════════════════════════════════");
      return 0;
    }

    if (signal === "COMPLETE") {
      if (taskComplete) {
        logProgress(workspace, "**Session ended** - ✅ TASK COMPLETE (agent signaled)");
        console.log("");
        console.log("🎉 RALPH COMPLETE! Agent signaled and criteria verified.");
        return 0;
      }
      logProgress(workspace, "**Session ended** - Agent signaled complete but criteria remain");
      console.log("⚠️ Agent signaled completion but unchecked criteria remain. Continuing...");
      iteration++;
      continue;
    }

    if (signal === "ROTATE") {
      logProgress(workspace, "**Session ended** - 🔄 Context rotation (token limit reached)");
      console.log("🔄 Rotating to fresh context...");
      iteration++;
      sessionId = undefined;
      continue;
    }

    if (signal === "GUTTER") {
      logProgress(workspace, "**Session ended** - 🚨 GUTTER (agent stuck)");
      console.error("🚨 Gutter detected. Check .ralph/errors.log for details.");
      return 1;
    }

    if (signal === "DEFER") {
      logProgress(workspace, "**Session ended** - ⏸️ DEFERRED (rate limit/transient)");
      console.log("⏸️ Rate limit or transient error. Waiting 30s...");
      await new Promise((r) => setTimeout(r, 30_000));
      continue;
    }

    const remaining = countRemaining(workspace);
    if (remaining > 0) {
      logProgress(workspace, `**Session ended** - Agent finished (${remaining} criteria remaining)`);
      console.log(`📋 ${remaining} criteria remaining. Starting next iteration...`);
      iteration++;
    }

    if (singleRun) break;
  }

  console.log(`⚠️ Max iterations (${maxIterations}) reached.`);
  return 1;
}
