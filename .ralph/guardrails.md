# Ralph Guardrails (Signs)

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

### Sign: Run test_command when tools available
- **Trigger**: After code changes; before marking task complete
- **Instruction**: Run the test_command from RALPH_TASK.md (e.g. `cd ralph-ts && npm run build`). If npm/node are not in PATH, document in progress.md and leave the build criterion unchecked until an environment with Node/npm can run it.
- **Added after**: Iteration 4 - build criterion could not be verified because npm was not in PATH

