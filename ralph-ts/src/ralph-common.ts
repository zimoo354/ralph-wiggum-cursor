/**
 * Ralph Wiggum: Common utilities (paths, env, spawn, constants).
 * Mirrors scripts/ralph-common.sh behavior.
 */

import * as fs from "fs";
import * as path from "path";

export const WARN_THRESHOLD = Number(process.env.WARN_THRESHOLD) || 70_000;
export const ROTATE_THRESHOLD = Number(process.env.ROTATE_THRESHOLD) || 80_000;
export const MAX_ITERATIONS = Number(process.env.MAX_ITERATIONS) || 20;
export const DEFAULT_MODEL = process.env.RALPH_MODEL || "auto";

export const TASK_CACHE_FILE = "tasks.yaml";
export const TASK_MTIME_FILE = "tasks.mtime";

/**
 * Get the .ralph directory path for a workspace.
 */
export function getRalphDir(workspace: string): string {
  return path.join(path.resolve(workspace), ".ralph");
}

/**
 * Ensure .ralph exists and has default files (progress.md, guardrails.md, errors.log, activity.log).
 */
export function initRalphDir(workspace: string): void {
  const ralphDir = getRalphDir(workspace);
  if (!fs.existsSync(ralphDir)) {
    fs.mkdirSync(ralphDir, { recursive: true });
  }

  const progressPath = path.join(ralphDir, "progress.md");
  if (!fs.existsSync(progressPath)) {
    fs.writeFileSync(
      progressPath,
      `# Progress Log

> Updated by the agent after significant work.

---

## Session History

`,
      "utf8"
    );
  }

  const guardrailsPath = path.join(ralphDir, "guardrails.md");
  if (!fs.existsSync(guardrailsPath)) {
    fs.writeFileSync(
      guardrailsPath,
      `# Ralph Guardrails (Signs)

> Lessons learned from past failures. READ THESE BEFORE ACTING.

## Core Signs

### Sign: Read Before Writing
- **Trigger**: Before modifying any file
- **Instruction**: Always read the existing file first
- **Added after**: Core principle

### Sign: Test After Changes
- **Trigger**: After any code change
- **Instruction**: Run tests to verify nothing broke
- **Added after**: Core principle

### Sign: Commit Checkpoints
- **Trigger**: Before risky changes
- **Instruction**: Commit current working state first
- **Added after**: Core principle

---

## Learned Signs

`,
      "utf8"
    );
  }

  const errorsPath = path.join(ralphDir, "errors.log");
  if (!fs.existsSync(errorsPath)) {
    fs.writeFileSync(
      errorsPath,
      `# Error Log

> Failures detected by stream-parser. Use to update guardrails.

`,
      "utf8"
    );
  }

  const activityPath = path.join(ralphDir, "activity.log");
  if (!fs.existsSync(activityPath)) {
    fs.writeFileSync(
      activityPath,
      `# Activity Log

> Real-time tool call logging from stream-parser.

`,
      "utf8"
    );
  }
}

/**
 * Resolve workspace to absolute path (default current working directory).
 */
export function resolveWorkspace(workspace: string | undefined): string {
  const base = workspace || process.cwd();
  return path.resolve(base);
}
