---
task: Rewrite Ralph Wiggum in TypeScript inside a subfolder (non-destructive)
test_command: "cd ralph-ts && npm run build"
completion_criteria:
  - TypeScript implementation lives in ralph-ts/ and does not modify existing scripts
  - Core behavior (stream parsing, task parsing, run loop) implemented and buildable
  - README in ralph-ts/ explains how to run and how it maps to the shell version
max_iterations: 20
---

# Task: Ralph Wiggum TypeScript Implementation (Non-Destructive)

## Overview

Implement a TypeScript version of Ralph Wiggum in a **new subfolder** `ralph-ts/`. The existing shell implementation (`scripts/*.sh`, `install.sh`, `.cursor/ralph-scripts/`) must remain **completely untouched**. No deletions, no edits, no moves of existing files. All new code and config live under `ralph-ts/`.

Goal: a maintainable TS codebase that can eventually be published as an npm package (e.g. runnable as `ralph-dev-agent`), with Phase 1 covering core behavior only.

## Non-Negotiable Constraints

- **No destructive operations.** Do not modify, delete, or move:
  - Any file under `scripts/`
  - `install.sh`
  - Any file under `.cursor/ralph-scripts/` (if present)
  - Root-level `README.md`, `SKILL.md`, or other existing docs (you may add new files or a new doc in `ralph-ts/` only)
- **All new code and assets live under `ralph-ts/`.** This includes package.json, tsconfig, source files, and a README for the TS implementation.
- **Reuse behavior, not code.** Implement the same behavior as the shell scripts by reading and mirroring their logic in TypeScript; do not source or call the shell scripts from TS (the TS app should be self-contained).

## Reference: Current Shell Behavior

Use these as reference only (read them to understand behavior; implement equivalent logic in TS):

| Shell component      | Purpose |
|----------------------|--------|
| `scripts/ralph-common.sh` | Shared helpers: paths, env, cursor-agent invocation, token limits, ROTATE/GUTTER/DEFER/COMPLETE signals |
| `scripts/stream-parser.sh` | Parses `cursor-agent --output-format stream-json` stdout; tracks tokens (read/write/assist/shell), emits signals, writes `.ralph/activity.log` and `.ralph/errors.log` |
| `scripts/task-parser.sh`  | Parses `RALPH_TASK.md` for checkboxes `[ ]` / `[x]`, optional YAML cache (`.ralph/tasks.yaml`), group annotations |
| `scripts/ralph-loop.sh`   | CLI loop: read task file, run agent with stream parser, handle ROTATE (new context) / GUTTER / DEFER / COMPLETE, respect max iterations |
| `scripts/ralph-once.sh`   | Single iteration (no loop) |
| `scripts/ralph-setup.sh`   | Interactive setup (gum UI for model, options); then runs the loop |
| `scripts/init-ralph.sh`   | Ensures `.ralph/` and optional `RALPH_TASK.md` exist |

Phase 1 scope: **Do not** implement parallel/worktree mode or the full gum-based setup UI. Focus on: stream parser, task parser, and a simple run loop (single iteration or N iterations) that can be driven from CLI or later by a wizard.

## Requirements

### Functional (Phase 1)

1. **Project scaffold** – `ralph-ts/` with `package.json`, `tsconfig.json`, and a clear layout (e.g. `src/` with modules for parser, task, run loop, CLI).
2. **Stream parser** – Parse `stream-json` output from `cursor-agent`; track token usage by category (read/write/assist/shell); emit or handle signals (e.g. ROTATE at 80k, WARN at 70k, COMPLETE, GUTTER, DEFER); write to `.ralph/activity.log` and `.ralph/errors.log` in the workspace.
3. **Task parser** – Read `RALPH_TASK.md` from workspace root; extract checklist items (`[ ]` / `[x]`); optional: cache in `.ralph/tasks.yaml` with mtime invalidation; support `<!-- group: N -->` for future parallel use.
4. **Run loop** – Run `cursor-agent` with the task prompt and stream output through the stream parser; support at least one of: single iteration or max-iterations loop; on ROTATE, continue from same task (fresh context); on COMPLETE, exit successfully; on GUTTER, exit with a distinct code or message.
5. **CLI entry** – A binary/entrypoint (e.g. `bin/ralph` or `dist/cli.js`) that can be run with `node` or via `npm run start` / `npx` from within `ralph-ts/`, accepting at least: workspace path (default current dir), and optionally max iterations and model (pass-through to cursor-agent).
6. **Workspace and .ralph** – Use a configurable workspace root (default `process.cwd()`); ensure `.ralph/` exists when running; read/write only under workspace (and `ralph-ts/` for package-local files).

### Non-Functional

- TypeScript only; strict types where practical.
- No runtime dependency on the existing shell scripts (TS app is self-contained).
- Build with `npm run build` (e.g. `tsc` or your chosen build) and pass from repo root: `cd ralph-ts && npm run build`.

## Success Criteria

The task is complete when ALL of the following are true:

1. [ ] `ralph-ts/` exists and contains `package.json` and `tsconfig.json` (and optionally a lockfile)
2. [ ] `cd ralph-ts && npm run build` succeeds with no errors
3. [ ] Stream parser module exists and can parse stream-json lines and compute token usage from file read/write/assist/shell events
4. [ ] Task parser module exists and can extract checklist items from a `RALPH_TASK.md`-style markdown string (and optionally write/read `.ralph/tasks.yaml`)
5. [ ] Run loop (or single-run) exists and spawns `cursor-agent` with correct args, pipes stdout through the stream parser, and respects at least one of: single iteration or max iterations
6. [ ] CLI entrypoint exists and accepts workspace path (and optionally max iterations / model); runs the loop or single iteration against the given workspace
7. [ ] No existing file outside `ralph-ts/` has been modified or deleted (only new files under `ralph-ts/` and possibly new root files like this RALPH_TASK.md)
8. [ ] `ralph-ts/README.md` exists and describes: how to build, how to run (e.g. `npx` or `node dist/cli.js`), what env vars or args are supported, and how the TS implementation maps to the shell scripts (e.g. “stream parser ≈ stream-parser.sh”)

## Out of Scope (Phase 1)

- Interactive wizard (gum-style) or .env config (Phase 2).
- Parallel mode / worktrees (shell `ralph-parallel.sh`).
- Changing or replacing `install.sh` or any script in `scripts/` or `.cursor/ralph-scripts/`.
- Publishing to npm or implementing `ralph-dev-agent` binary name (can be Phase 2).

## Suggested Layout (Optional)

```
ralph-ts/
  package.json
  tsconfig.json
  src/
    index.ts        # CLI entry
    stream-parser.ts
    task-parser.ts
    run-loop.ts
    ralph-common.ts # paths, spawn cursor-agent, constants
  README.md
```

You may adjust names and structure as long as the success criteria are met.

---

## Ralph Instructions

When working on this task:

1. Read `.ralph/progress.md` to see what's been done.
2. Check `.ralph/guardrails.md` for signs to follow.
3. Work on the next incomplete criterion (marked `[ ]`); do not modify or delete any file outside `ralph-ts/`.
4. Update `.ralph/progress.md` with your progress.
5. Commit changes frequently (only under `ralph-ts/` and any new files you add).
6. Run `cd ralph-ts && npm run build` after changes to verify the project builds.
7. When ALL criteria are met (all `[ ]` → `[x]`), output: `<ralph>COMPLETE</ralph>`
8. If stuck on the same issue 3+ times, output: `<ralph>GUTTER</ralph>`
