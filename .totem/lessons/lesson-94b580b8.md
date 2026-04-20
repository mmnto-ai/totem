## Lesson — Inherit stdio for startup hooks

**Tags:** node, cli, dx
**Scope:** .gemini/hooks/*.js, packages/cli/src/commands/init-templates.ts

Using `pipe` for child process stdio in hooks can swallow output if the command logs to stderr. Use `inherit` to ensure startup context actually reaches the agent session terminal.
