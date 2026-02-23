# Ralph Wiggum (TypeScript)

TypeScript implementation of the Ralph autonomous development loop. It lives in `ralph-ts/` and does not modify the existing shell scripts.

## Build

From the repo root:

```bash
cd ralph-ts && npm run build
```

Or from inside `ralph-ts`:

```bash
npm run build
```

## Run

- **From repo root (after build):**
  ```bash
  node ralph-ts/dist/index.js [options] [workspace]
  ```
- **From inside `ralph-ts`:**
  ```bash
  npm start -- [options] [workspace]
  ```
- **With npx (from repo root):**
  ```bash
  npx -C ralph-ts . [options] [workspace]
  ```

`workspace` defaults to the current directory. All paths and `.ralph/` state are relative to that workspace.

## Options

| Option | Description |
|--------|-------------|
| `-n`, `--iterations N` | Max iterations (default: 20) |
| `-m`, `--model MODEL` | Model for `cursor-agent` (default: `auto` or `RALPH_MODEL`) |
| `--once` | Single iteration (no loop) |
| `-h`, `--help` | Show help |

## Environment

- `RALPH_MODEL` – Override default model (same as `-m`).

## Mapping to shell scripts

| Shell script | TypeScript module | Purpose |
|-------------|-------------------|---------|
| `scripts/ralph-common.sh` | `src/ralph-common.ts` | Paths, env, `.ralph/` init, iteration state, logging |
| `scripts/stream-parser.sh` | `src/stream-parser.ts` | Parse `cursor-agent --output-format stream-json`; track tokens (read/write/assist/shell); emit ROTATE/WARN/GUTTER/COMPLETE/DEFER; write `.ralph/activity.log` and `.ralph/errors.log` |
| `scripts/task-parser.sh` | `src/task-parser.ts` | Parse `RALPH_TASK.md` checkboxes `[ ]` / `[x]`; optional `.ralph/tasks.yaml` cache with mtime; support `<!-- group: N -->` |
| `scripts/ralph-loop.sh` | `src/run-loop.ts` + `src/index.ts` | CLI loop: run `cursor-agent`, pipe stdout through stream parser, handle ROTATE/COMPLETE/GUTTER/DEFER, respect max iterations |

The TS app is self-contained and does not call the shell scripts.
