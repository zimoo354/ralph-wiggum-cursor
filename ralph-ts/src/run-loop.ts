/**
 * Ralph Wiggum: Run Loop
 * Spawns cursor-agent with stream-json, pipes through stream parser, handles signals.
 * Mirrors scripts/ralph-loop.sh / ralph-common.sh run_iteration and run_ralph_loop behavior.
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { ParserSignal } from "./stream-parser.js";
import { StreamParser } from "./stream-parser.js";
import {
  initRalphDir,
  getIteration,
  setIteration,
  incrementIteration,
  getModel,
} from "./ralph-common.js";
import { isAllComplete } from "./task-parser.js";

const MAX_ITERATIONS_DEFAULT = 20;

function buildPrompt(workspace: string, iteration: number): string {
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
   Always describe what you actually did - never use placeholders like '<description>'
2. After any significant code change (even partial): commit with descriptive message
3. Before any risky refactor: commit current state as checkpoint
4. Push after every 2-3 commits: \`git push\`

If you get rotated, the next agent picks up from your last commit. Your commits ARE your memory.

## Task Execution

1. Work on the next unchecked criterion in RALPH_TASK.md (look for \`[ ]\`)
2. Run tests after changes (check RALPH_TASK.md for test_command)
3. **Mark completed criteria**: Edit RALPH_TASK.md and change \`[ ]\` to \`[x]\`
4. Update \`.ralph/progress.md\` with what you accomplished
5. When ALL criteria show \`[x]\`: output \`<ralph>COMPLETE</ralph>\`
6. If stuck 3+ times on same issue: output \`<ralph>GUTTER</ralph>\`

## Learning from Failures

When something fails:
1. Check \`.ralph/errors.log\` for failure history
2. Figure out the root cause
3. Add a Sign to \`.ralph/guardrails.md\` using the format described there.

## Context Rotation Warning

When context is running low:
1. Finish your current file edit
2. Commit and push your changes
3. Update .ralph/progress.md with what you accomplished and what's next
4. You will be rotated to a fresh agent that continues your work

Begin by reading the state files.`;
}

export interface RunLoopOptions {
  workspace: string;
  maxIterations?: number;
  model?: string;
  singleRun?: boolean;
}

export type RunLoopSignal = ParserSignal | "TASK_COMPLETE" | "MAX_ITERATIONS";

export interface RunIterationResult {
  signal: RunLoopSignal | null;
  taskComplete: boolean;
}

/** Run a single agent iteration; returns signal if any */
export function runIteration(
  workspace: string,
  iteration: number,
  model: string
): Promise<RunIterationResult> {
  return new Promise((resolve) => {
    const prompt = buildPrompt(workspace, iteration);
    let resolved = false;
    const finish = (signal: RunLoopSignal | null, taskComplete: boolean) => {
      if (resolved) return;
      resolved = true;
      parser.endSession();
      try {
        agent.kill("SIGTERM");
      } catch {
        // ignore
      }
      resolve({ signal, taskComplete });
    };

    const parser = new StreamParser({
      workspace,
      onSignal(signal) {
        if (signal === "ROTATE" || signal === "GUTTER" || signal === "COMPLETE" || signal === "DEFER") {
          finish(signal, false);
        }
      },
    });
    parser.startSession();

    const agent = spawn(
      "cursor-agent",
      ["-p", "--force", "--output-format", "stream-json", "--model", model, prompt],
      {
        cwd: workspace,
        stdio: ["ignore", "pipe", "inherit"],
        shell: false,
      }
    );

    const stdout = agent.stdout;
    if (!stdout) {
      finish(null, false);
      return;
    }

    let buffer = "";
    stdout.setEncoding("utf8");
    stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        parser.processLine(line);
        parser.maybeLogTokenStatus();
      }
    });
    stdout.on("end", () => {
      if (buffer) parser.processLine(buffer);
      agent.on("close", (code) => {
        if (!resolved) {
          const taskComplete = isAllComplete(workspace);
          finish(taskComplete ? "TASK_COMPLETE" : null, taskComplete);
        }
      });
    });
    agent.on("error", (err) => {
      if (!resolved) finish(null, false);
    });
  });
}

/** Run the main loop (multiple iterations until complete or max) */
export async function runLoop(options: RunLoopOptions): Promise<{ exitCode: number; reason: string }> {
  const {
    workspace,
    maxIterations = MAX_ITERATIONS_DEFAULT,
    model = getModel(),
    singleRun = false,
  } = options;

  initRalphDir(workspace);
  const taskPath = path.resolve(workspace, "RALPH_TASK.md");
  if (!fs.existsSync(taskPath)) {
    return { exitCode: 1, reason: "No RALPH_TASK.md in workspace" };
  }

  if (singleRun) {
    const iteration = getIteration(workspace) + 1;
    const { signal, taskComplete } = await runIteration(workspace, iteration, model);
    if (taskComplete) return { exitCode: 0, reason: "TASK_COMPLETE" };
    if (signal === "GUTTER") return { exitCode: 1, reason: "GUTTER" };
    if (signal === "COMPLETE") return { exitCode: 0, reason: "COMPLETE" };
    if (signal === "ROTATE") return { exitCode: 0, reason: "ROTATE" };
    if (signal === "DEFER") return { exitCode: 2, reason: "DEFER" };
    return { exitCode: 0, reason: "single run finished" };
  }

  let iteration = getIteration(workspace);
  for (let i = 0; i < maxIterations; i++) {
    iteration = incrementIteration(workspace);
    const { signal, taskComplete } = await runIteration(workspace, iteration, model);

    if (taskComplete) {
      return { exitCode: 0, reason: "TASK_COMPLETE" };
    }
    if (signal === "COMPLETE") {
      if (isAllComplete(workspace)) return { exitCode: 0, reason: "TASK_COMPLETE" };
    }
    if (signal === "GUTTER") {
      return { exitCode: 1, reason: "GUTTER" };
    }
    if (signal === "ROTATE") {
      // continue with same task, fresh context
      continue;
    }
    if (signal === "DEFER") {
      await new Promise((r) => setTimeout(r, 30000));
      setIteration(workspace, iteration - 1);
      i--;
      continue;
    }
    if (isAllComplete(workspace)) return { exitCode: 0, reason: "TASK_COMPLETE" };
  }

  return { exitCode: 1, reason: "MAX_ITERATIONS" };
}
