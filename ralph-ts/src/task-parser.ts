/**
 * Ralph Wiggum: Task Parser
 * Parses RALPH_TASK.md for checkboxes; optional .ralph/tasks.yaml cache with mtime invalidation.
 * Supports <!-- group: N --> for future parallel use.
 * Mirrors scripts/task-parser.sh behavior.
 */

import * as fs from "fs";
import * as path from "path";
import { getRalphDir, TASK_CACHE_FILE, TASK_MTIME_FILE } from "./ralph-common.js";

const CHECKBOX_REGEX = /^\s*([-*]|\d+\.)\s+\[(x|X| )]\s+(.*)$/;
const GROUP_REGEX = /<!--\s*group:\s*(\d+)\s*-->/;
const DEFAULT_GROUP = 999999;

export interface TaskItem {
  id: string;
  lineNumber: number;
  status: "pending" | "completed";
  description: string;
  parallelGroup: number;
}

function getFileMtime(filePath: string): number {
  try {
    const stat = fs.statSync(filePath);
    return stat.mtimeMs;
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
  const cachedMtime = Number(fs.readFileSync(mtimePath, "utf8").trim()) || 0;
  return currentMtime === cachedMtime;
}

function parseTasksFromMarkdown(content: string): TaskItem[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const tasks: TaskItem[] = [];
  lines.forEach((line, i) => {
    const match = line.match(CHECKBOX_REGEX);
    if (!match) return;
    const [, , statusChar, rest] = match;
    let description = rest ?? "";
    let parallelGroup = DEFAULT_GROUP;
    const groupMatch = line.match(GROUP_REGEX);
    if (groupMatch) parallelGroup = parseInt(groupMatch[1], 10);
    description = description.replace(/\s*<!--\s*group:\s*\d+\s*-->\s*/g, "").trim();
    const status = statusChar === "x" || statusChar === "X" ? "completed" : "pending";
    tasks.push({
      id: `line_${i + 1}`,
      lineNumber: i + 1,
      status,
      description,
      parallelGroup,
    });
  });
  return tasks;
}

function writeCache(workspace: string, taskFilePath: string, tasks: TaskItem[]): void {
  const ralphDir = getRalphDir(workspace);
  const cachePath = path.join(ralphDir, TASK_CACHE_FILE);
  const mtimePath = path.join(ralphDir, TASK_MTIME_FILE);
  const mtime = getFileMtime(taskFilePath);
  const escape = (s: string) => (s.includes(":") || s.includes('"') ? `"${s.replace(/"/g, '\\"')}"` : s);
  const lines = [
    "# Ralph Task Cache",
    "# Auto-generated from RALPH_TASK.md",
    "# DO NOT EDIT - regenerated on task file change",
    "",
    "source_file: RALPH_TASK.md",
    `source_mtime: ${mtime}`,
    `generated_at: ${new Date().toISOString()}`,
    "",
    "tasks:",
    ...tasks.map(
      (t) =>
        `  - id: "${t.id}"\n    line_number: ${t.lineNumber}\n    status: ${t.status}\n    parallel_group: ${t.parallelGroup}\n    description: ${escape(t.description)}`
    ),
  ];
  if (!fs.existsSync(ralphDir)) fs.mkdirSync(ralphDir, { recursive: true });
  fs.writeFileSync(cachePath, lines.join("\n") + "\n", "utf8");
  fs.writeFileSync(mtimePath, String(mtime), "utf8");
}

/**
 * Parse tasks from RALPH_TASK.md; update .ralph/tasks.yaml if needed.
 * Returns list of tasks (from cache or fresh parse).
 */
export function parseTasks(workspace: string): TaskItem[] {
  const resolved = path.resolve(workspace);
  const taskFilePath = path.join(resolved, "RALPH_TASK.md");
  if (!fs.existsSync(taskFilePath)) {
    throw new Error(`No RALPH_TASK.md found in ${resolved}`);
  }
  if (isCacheValid(resolved, taskFilePath)) {
    return readTasksFromCache(resolved);
  }
  const content = fs.readFileSync(taskFilePath, "utf8");
  const tasks = parseTasksFromMarkdown(content);
  writeCache(resolved, taskFilePath, tasks);
  return tasks;
}

function readTasksFromCache(workspace: string): TaskItem[] {
  const cachePath = path.join(getRalphDir(workspace), TASK_CACHE_FILE);
  const lines = fs.readFileSync(cachePath, "utf8").split("\n");
  const tasks: TaskItem[] = [];
  let current: Partial<TaskItem> = {};
  for (const raw of lines) {
    const line = raw.trimStart();
    if (line.startsWith("- id:")) {
      if (current.id) tasks.push(current as TaskItem);
      const idPart = line.replace(/^-\s+id:\s*/, "").trim().replace(/^["']|["']$/g, "");
      current = { id: idPart };
    } else if (line.startsWith("line_number:")) {
      current.lineNumber = parseInt(line.replace("line_number:", "").trim(), 10);
    } else if (line.startsWith("status:")) {
      current.status = line.replace("status:", "").trim() as "pending" | "completed";
    } else if (line.startsWith("parallel_group:")) {
      current.parallelGroup = parseInt(line.replace("parallel_group:", "").trim(), 10);
    } else if (line.startsWith("description:")) {
      let desc = line.replace("description:", "").trim();
      if (desc.startsWith('"') && desc.endsWith('"')) desc = desc.slice(1, -1).replace(/\\"/g, '"');
      current.description = desc;
    }
  }
  if (current.id) tasks.push(current as TaskItem);
  return tasks;
}

/**
 * Extract checklist items from a markdown string (no cache).
 */
export function extractChecklistFromMarkdown(markdown: string): TaskItem[] {
  return parseTasksFromMarkdown(markdown);
}

/**
 * Get all tasks for workspace (parses and caches as needed).
 */
export function getAllTasks(workspace: string): TaskItem[] {
  return parseTasks(workspace);
}

/**
 * Get next pending task, or undefined if all complete.
 */
export function getNextTask(workspace: string): TaskItem | undefined {
  return getAllTasks(workspace).find((t) => t.status === "pending");
}

/**
 * Count remaining (pending) tasks.
 */
export function countRemaining(workspace: string): number {
  return getAllTasks(workspace).filter((t) => t.status === "pending").length;
}

/**
 * Count completed tasks.
 */
export function countCompleted(workspace: string): number {
  return getAllTasks(workspace).filter((t) => t.status === "completed").length;
}

/**
 * Get progress as "done:total".
 */
export function getProgress(workspace: string): string {
  const tasks = getAllTasks(workspace);
  const done = tasks.filter((t) => t.status === "completed").length;
  return `${done}:${tasks.length}`;
}

/**
 * Mark a task complete by id (line_N). Updates RALPH_TASK.md and invalidates cache.
 */
export function markTaskComplete(workspace: string, taskId: string): void {
  const resolved = path.resolve(workspace);
  const taskFilePath = path.join(resolved, "RALPH_TASK.md");
  const m = taskId.match(/^line_(\d+)$/);
  if (!m) throw new Error(`Invalid task id: ${taskId} (expected line_N)`);
  const lineNum = parseInt(m[1], 10);
  let content = fs.readFileSync(taskFilePath, "utf8");
  const lines = content.split("\n");
  if (lineNum < 1 || lineNum > lines.length) throw new Error(`Line ${lineNum} out of range`);
  const line = lines[lineNum - 1];
  if (!line.includes("[ ]")) throw new Error(`Line ${lineNum} is not an unchecked item`);
  lines[lineNum - 1] = line.replace("[ ]", "[x]");
  fs.writeFileSync(taskFilePath, lines.join("\n"), "utf8");
  const mtimePath = path.join(getRalphDir(resolved), TASK_MTIME_FILE);
  if (fs.existsSync(mtimePath)) fs.unlinkSync(mtimePath);
}

/**
 * Check if task file is complete (no unchecked criteria).
 */
export function isTaskComplete(workspace: string): boolean {
  return countRemaining(workspace) === 0;
}
