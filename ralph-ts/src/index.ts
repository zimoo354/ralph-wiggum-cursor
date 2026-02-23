#!/usr/bin/env node
/**
 * Ralph Wiggum: CLI entrypoint
 * Accepts workspace path, max iterations, model; runs loop or single iteration.
 * Mirrors scripts/ralph-loop.sh usage.
 */

import * as fs from "fs";
import * as path from "path";
import { runLoop } from "./run-loop.js";
import { initRalphDir, resolveWorkspace, getModel } from "./ralph-common.js";
import { getAllTasks, countRemaining } from "./task-parser.js";

function parseArgs(argv: string[]): {
  workspace: string;
  maxIterations: number;
  model: string;
  singleRun: boolean;
  help: boolean;
} {
  let workspace = process.cwd();
  let maxIterations = 20;
  let model = getModel();
  let singleRun = false;
  let help = false;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      help = true;
      break;
    }
    if (arg === "-n" || arg === "--iterations") {
      maxIterations = parseInt(argv[++i], 10) || 20;
      continue;
    }
    if (arg === "-m" || arg === "--model") {
      model = argv[++i] ?? "auto";
      continue;
    }
    if (arg === "--once") {
      singleRun = true;
      continue;
    }
    if (!arg.startsWith("-")) {
      workspace = arg;
      break;
    }
  }

  return {
    workspace: resolveWorkspace(workspace),
    maxIterations,
    model,
    singleRun,
    help,
  };
}

function showHelp(): void {
  console.log(`
Ralph Wiggum: TypeScript CLI

Usage:
  ralph [options] [workspace]

Options:
  -n, --iterations N   Max iterations (default: 20)
  -m, --model MODEL    Model for cursor-agent (default: auto or RALPH_MODEL)
  --once               Single iteration (no loop)
  -h, --help           Show this help

Examples:
  ralph                          # Run from current directory
  ralph /path/to/project         # Run from specific workspace
  ralph -n 50 -m gpt-5.2-high    # 50 iterations, specific model
  ralph --once .                 # Single run

Environment:
  RALPH_MODEL    Override default model (same as -m)
`);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv);

  if (args.help) {
    showHelp();
    return 0;
  }

  const taskPath = path.resolve(args.workspace, "RALPH_TASK.md");
  if (!fs.existsSync(taskPath)) {
    console.error("❌ No RALPH_TASK.md found in", args.workspace);
    return 1;
  }

  initRalphDir(args.workspace);
  const remaining = countRemaining(args.workspace);
  const total = getAllTasks(args.workspace).length;

  if (total > 0 && remaining === 0) {
    console.log("🎉 Task already complete! All criteria are checked.");
    return 0;
  }

  console.log("");
  console.log("Workspace:", args.workspace);
  console.log("Model:    ", args.model);
  console.log("Progress: ", `${total - remaining} / ${total} criteria (${remaining} remaining)`);
  if (!args.singleRun) {
    console.log("Max iter: ", args.maxIterations);
  }
  console.log("");

  const result = await runLoop({
    workspace: args.workspace,
    maxIterations: args.maxIterations,
    model: args.model,
    singleRun: args.singleRun,
  });

  if (result.reason === "TASK_COMPLETE") {
    console.log("🎉 RALPH COMPLETE! All criteria satisfied.");
    return 0;
  }
  if (result.reason === "GUTTER") {
    console.error("🚨 Gutter detected. Check .ralph/errors.log");
    return 1;
  }
  if (result.reason === "MAX_ITERATIONS") {
    console.error("⚠️ Max iterations reached. Task may be incomplete.");
    return 1;
  }
  if (result.reason === "DEFER") {
    console.log("⏸️ Deferred (rate limit/transient). Retry later.");
    return 2;
  }

  return result.exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
