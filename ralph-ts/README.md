# Ralph Wiggum (TypeScript)

TypeScript implementation of the Ralph Wiggum autonomous development agent. It lives in `ralph-ts/` and does not modify the existing shell scripts; it reimplements the same behavior for a maintainable, buildable codebase.

## Build

From the repo root:

```bash
cd ralph-ts && npm run build
```

Or from inside `ralph-ts/`:

```bash
npm run build
```

Requires Node 18+ and no extra dependencies (TypeScript is devDependency for build).

## Run

- **From repo root (after build):**
  ```bash
  cd ralph-ts && node dist/cli.js
  ```
  or
  ```bash
  cd ralph-ts && npm run start
  ```

- **With workspace path (default is current directory):**
  ```bash
  node dist/cli.js /path/to/workspace
  ```

- **Options:**
  - `-n, --iterations N` — max iterations (default: 20)
  - `-m, --model MODEL` — model for `cursor-agent` (default: `auto`)
  - `--once` — single iteration, no loop
  - `-h, --help` — show help

Examples:

```bash
node dist/cli.js
node dist/cli.js -n 50 -m auto
node dist/cli.js --once .
```

## Environment

- `RALPH_MODEL` — same as `-m` (default: `auto`)
- `MAX_ITERATIONS` — same as `-n` (default: 20)
- `WARN_THRESHOLD` — token count to emit WARN (default: 70000)
- `ROTATE_THRESHOLD` — token count to trigger ROTATE (default: 80000)

## Workspace and .ralph

- Workspace root defaults to `process.cwd()` and can be set via the first positional argument.
- All reads/writes under the workspace go to that path; `.ralph/` is created there when running.
- The CLI ensures `.ralph/` exists (with `progress.md`, `guardrails.md`, `errors.log`, `activity.log`) before running.

## Mapping to shell scripts

| Shell component | TypeScript equivalent |
|-----------------|------------------------|
| `scripts/ralph-common.sh` | `src/ralph-common.ts` — paths, env, token limits, init `.ralph/` |
| `scripts/stream-parser.sh` | `src/stream-parser.ts` — parse `stream-json`, token usage (read/write/assist/shell), ROTATE/WARN/GUTTER/COMPLETE/DEFER, write `activity.log` and `errors.log` |
| `scripts/task-parser.sh` | `src/task-parser.ts` — parse `RALPH_TASK.md` checkboxes, optional `.ralph/tasks.yaml` cache with mtime, `<!-- group: N -->` support |
| `scripts/ralph-loop.sh` | `src/run-loop.ts` — run `cursor-agent`, pipe through stream parser, single or max-iterations loop, handle ROTATE/COMPLETE/GUTTER/DEFER |
| `scripts/ralph-once.sh` | CLI `--once` flag — single iteration |

The TS app is self-contained: it does not call or source any shell scripts.
