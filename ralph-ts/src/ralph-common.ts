/**
 * Ralph Wiggum: Common utilities (paths, env, spawn, constants).
 * Mirrors scripts/ralph-common.sh behavior.
 */

import * as fs from "fs";
import * as path from "path";

// Token thresholds (match stream-parser.sh)
export const WARN_THRESHOLD = Number(process.env.WARN_THRESHOLD) || 70_000;
export const ROTATE_THRESHOLD = Number(process.env.ROTATE_THRESHOLD) || 80_000;

// Iteration limits
export const MAX_ITERATIONS_DEFAULT = Number(process.env.MAX_ITERATIONS) || 20;

// Model selection
export const DEFAULT_MODEL = "auto";
export const getModel = (): string => process.env.RALPH_MODEL ?? DEFAULT_MODEL;

/** Get the .ralph directory for a workspace */
export function getRalphDir(workspace: string = "."): string {
  return path.resolve(workspace, ".ralph");
}

/** Ensure .ralph exists and has default files */
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

/** Log a message to activity.log */
export function logActivity(workspace: string, message: string): void {
  const ralphDir = getRalphDir(workspace);
  const activityPath = path.join(ralphDir, "activity.log");
  const timestamp = new Date().toLocaleTimeString("en-GB", { hour12: false });
  fs.appendFileSync(activityPath, `[${timestamp}] ${message}\n`, "utf8");
}

/** Log an error to errors.log */
export function logError(workspace: string, message: string): void {
  const ralphDir = getRalphDir(workspace);
  const errorsPath = path.join(ralphDir, "errors.log");
  const timestamp = new Date().toLocaleTimeString("en-GB", { hour12: false });
  fs.appendFileSync(errorsPath, `[${timestamp}] ${message}\n`, "utf8");
}

/** Get current iteration from .ralph/.iteration */
export function getIteration(workspace: string): number {
  const statePath = path.join(getRalphDir(workspace), ".iteration");
  if (!fs.existsSync(statePath)) return 0;
  const content = fs.readFileSync(statePath, "utf8").trim();
  const n = parseInt(content, 10);
  return Number.isNaN(n) ? 0 : n;
}

/** Set iteration number */
export function setIteration(workspace: string, iteration: number): void {
  const ralphDir = getRalphDir(workspace);
  if (!fs.existsSync(ralphDir)) fs.mkdirSync(ralphDir, { recursive: true });
  fs.writeFileSync(path.join(ralphDir, ".iteration"), String(iteration), "utf8");
}

/** Increment iteration and return new value */
export function incrementIteration(workspace: string): number {
  const current = getIteration(workspace);
  const next = current + 1;
  setIteration(workspace, next);
  return next;
}

/** Resolve workspace to absolute path */
export function resolveWorkspace(workspace: string): string {
  if (!workspace || workspace === ".") return process.cwd();
  return path.resolve(workspace);
}
