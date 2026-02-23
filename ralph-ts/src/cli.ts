#!/usr/bin/env node
/**
 * Ralph Wiggum CLI
 * Entrypoint: workspace path (default cwd), optional max iterations and model.
 */

import * as fs from "fs";
import * as path from "path";
import { runRalphLoop } from "./run-loop.js";
import { resolveWorkspace, initRalphDir, MAX_ITERATIONS, DEFAULT_MODEL } from "./ralph-common.js";
import { getAllTasks, countRemaining } from "./task-parser.js";

function showHelp(): void {
  console.log(`Ralph Wiggum (TypeScript)

Usage:
  ralph [options] [workspace]

Options:
  -n, --iterations N   Max iterations (default: ${MAX_ITERATIONS})
  -m, --model MODEL    Model for cursor-agent (default: ${DEFAULT_MODEL})
  --once               Single iteration (no loop)
  -h, --help           Show this help

Examples:
  ralph
  ralph /path/to/project
  ralph -n 50 -m auto
  ralph --once .
`);
}

function parseArgs(argv: string[]): {
  workspace: string | undefined;
  maxIterations: number;
  model: string;
  singleRun: boolean;
  help: boolean;
} {
  let workspace: string | undefined;
  let maxIterations = MAX_ITERATIONS;
  let model = DEFAULT_MODEL;
  let singleRun = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }
    if (arg === "--once") {
      singleRun = true;
      continue;
    }
    if (arg === "-n" || arg === "--iterations") {
      maxIterations = parseInt(argv[++i], 10) || MAX_ITERATIONS;
      continue;
    }
    if (arg === "-m" || arg === "--model") {
      model = argv[++i] ?? model;
      continue;
    }
    if (!arg.startsWith("-")) {
      workspace = arg;
    }
  }

  return { workspace, maxIterations, model, singleRun, help };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    return 0;
  }

  const workspace = resolveWorkspace(args.workspace);
  const taskFile = path.join(workspace, "RALPH_TASK.md");

  if (!fs.existsSync(taskFile)) {
    console.error(`❌ No RALPH_TASK.md found in ${workspace}`);
    return 1;
  }

  initRalphDir(workspace);

  const tasks = getAllTasks(workspace);
  const remaining = countRemaining(workspace);
  const total = tasks.length;

  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("🐛 Ralph Wiggum: Autonomous Development Loop (TypeScript)");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("");
  console.log(`Workspace: ${workspace}`);
  console.log(`Task:     ${taskFile}`);
  console.log(`Progress: ${total - remaining} / ${total} criteria (${remaining} remaining)`);
  console.log(`Model:    ${args.model}`);
  console.log(`Max iter: ${args.maxIterations}`);
  if (args.singleRun) console.log("Mode:     single run");
  console.log("");

  if (remaining === 0 && total > 0) {
    console.log("🎉 Task already complete! All criteria are checked.");
    return 0;
  }

  return runRalphLoop({
    workspace,
    maxIterations: args.maxIterations,
    model: args.model,
    singleRun: args.singleRun,
  });
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
