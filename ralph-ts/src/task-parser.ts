/**
 * Ralph Wiggum: Task Parser
 * Parses RALPH_TASK.md for checkboxes; optional YAML cache with mtime invalidation.
 * Mirrors scripts/task-parser.sh behavior.
 */

import * as fs from "fs";
import * as path from "path";
import { getRalphDir } from "./ralph-common.js";

const TASK_CACHE_FILE = "tasks.yaml";
const TASK_MTIME_FILE = "tasks.mtime";
const DEFAULT_GROUP = 999999;

export interface TaskItem {
  id: string;
  lineNumber: number;
  status: "pending" | "completed";
  description: string;
  parallelGroup?: number;
}

const CHECKBOX_REGEX = /^[ \t]*([-*]|[0-9]+\.)[ \t]+\[([xX ])\][ \t]+(.*)$/;
const GROUP_COMMENT_REGEX = /<!--[ \t]*group:[ \t]*([0-9]+)[ \t]*-->/;

function getFileMtime(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function isCacheValid(workspace: string, taskFilePath: string): boolean {
  const ralphDir = getRalphDir(workspace);
  const cachePath = path.join(ralphDir, TASK_CACHE_FILE);
  const mtimePath = path.join(ralphDir, TASK_MTIME_FILE);
  if (!fs.existsSync(cachePath) || !fs.existsSync(mtimePath)) return false;
  const currentMtime = getFileMtime(taskFilePath);
  const cachedMtime = parseFloat(fs.readFileSync(mtimePath, "utf8").trim()) || 0;
  return currentMtime === cachedMtime;
}

function parseTasksFromMarkdown(content: string): TaskItem[] {
  const tasks: TaskItem[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(CHECKBOX_REGEX);
    if (!match) continue;
    const [, , statusChar, rest] = match;
    const groupMatch = rest.match(GROUP_COMMENT_REGEX);
    const parallelGroup = groupMatch ? parseInt(groupMatch[1], 10) : DEFAULT_GROUP;
    const description = rest.replace(GROUP_COMMENT_REGEX, "").replace(/\s+/g, " ").trim();
    const status = statusChar === "x" || statusChar === "X" ? "completed" : "pending";
    tasks.push({
      id: `line_${i + 1}`,
      lineNumber: i + 1,
      status,
      description,
      parallelGroup,
    });
  }
  return tasks;
}

function writeCache(workspace: string, taskFilePath: string, tasks: TaskItem[]): void {
  const ralphDir = getRalphDir(workspace);
  if (!fs.existsSync(ralphDir)) fs.mkdirSync(ralphDir, { recursive: true });
  const cachePath = path.join(ralphDir, TASK_CACHE_FILE);
  const mtimePath = path.join(ralphDir, TASK_MTIME_FILE);
  const currentMtime = getFileMtime(taskFilePath);
  const lines = [
    "# Ralph Task Cache",
    "# Auto-generated from RALPH_TASK.md",
    "# DO NOT EDIT - regenerated on task file change",
    "",
    "source_file: RALPH_TASK.md",
    `source_mtime: ${currentMtime}`,
    `generated_at: ${new Date().toISOString()}`,
    "",
    "tasks:",
    ...tasks.flatMap((t) => [
      `  - id: "${t.id}"`,
      `    line_number: ${t.lineNumber}`,
      `    status: ${t.status}`,
      `    parallel_group: ${t.parallelGroup ?? DEFAULT_GROUP}`,
      `    description: "${t.description.replace(/"/g, '\\"')}"`,
    ]),
  ];
  fs.writeFileSync(cachePath, lines.join("\n"), "utf8");
  fs.writeFileSync(mtimePath, String(currentMtime), "utf8");
}

/** Parse tasks from RALPH_TASK.md; update cache if needed */
export function parseTasks(workspace: string): TaskItem[] {
  const taskPath = path.resolve(workspace, "RALPH_TASK.md");
  if (!fs.existsSync(taskPath)) {
    throw new Error(`No RALPH_TASK.md found in ${workspace}`);
  }
  const content = fs.readFileSync(taskPath, "utf8");
  const tasks = parseTasksFromMarkdown(content);
  if (!isCacheValid(workspace, taskPath)) {
    writeCache(workspace, taskPath, tasks);
  }
  return tasks;
}

/** Get all tasks (from cache or parse) */
export function getAllTasks(workspace: string): TaskItem[] {
  return parseTasks(workspace);
}

/** Get the next pending task */
export function getNextTask(workspace: string): TaskItem | null {
  const tasks = getAllTasks(workspace);
  return tasks.find((t) => t.status === "pending") ?? null;
}

/** Count remaining (pending) tasks */
export function countRemaining(workspace: string): number {
  const tasks = getAllTasks(workspace);
  return tasks.filter((t) => t.status === "pending").length;
}

/** Count completed tasks */
export function countCompleted(workspace: string): number {
  const tasks = getAllTasks(workspace);
  return tasks.filter((t) => t.status === "completed").length;
}

/** Get progress as "done:total" */
export function getProgress(workspace: string): string {
  const done = countCompleted(workspace);
  const total = getAllTasks(workspace).length;
  return `${done}:${total}`;
}

/** Check if all tasks are complete */
export function isAllComplete(workspace: string): boolean {
  return countRemaining(workspace) === 0;
}

/** Mark a task complete by ID (line_N); modifies RALPH_TASK.md */
export function markTaskComplete(workspace: string, taskId: string): void {
  const match = taskId.match(/^line_(\d+)$/);
  if (!match) throw new Error(`Invalid task ID: ${taskId} (expected line_N)`);
  const lineNum = parseInt(match[1], 10);
  const taskPath = path.resolve(workspace, "RALPH_TASK.md");
  if (!fs.existsSync(taskPath)) throw new Error(`Task file not found: ${taskPath}`);
  const lines = fs.readFileSync(taskPath, "utf8").split(/\r?\n/);
  if (lineNum < 1 || lineNum > lines.length) throw new Error(`Line ${lineNum} out of range`);
  const line = lines[lineNum - 1];
  if (!line.includes("[ ]")) throw new Error(`Line ${lineNum} is not an unchecked item`);
  lines[lineNum - 1] = line.replace("[ ]", "[x]");
  fs.writeFileSync(taskPath, lines.join("\n"), "utf8");
  const mtimePath = path.join(getRalphDir(workspace), TASK_MTIME_FILE);
  if (fs.existsSync(mtimePath)) fs.unlinkSync(mtimePath);
}
