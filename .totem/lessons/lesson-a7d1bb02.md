## Lesson — Use explicit pnpm exec for binaries

**Tags:** pnpm, windows, cli, shell
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

In distributed text, invoke a workspace binary as `pnpm exec <name>`, never as a bare `pnpm <name>`. The two forms resolve the same bin — pnpm 11 hands an unknown name to `pnpm exec` only after it finds neither a builtin command nor a declared script of that name, with the same `node_modules/.bin` prepend and the same spawn — so the explicit form is the documented one, not a different resolver. A bare form depends on that fallback order, fails outright where no script runner applies, and once opened a `cmd` banner instead of the command on a Windows consumer (mmnto-ai/totem#2903; one occurrence, not reproduced on the same machine from PowerShell or Git Bash).
