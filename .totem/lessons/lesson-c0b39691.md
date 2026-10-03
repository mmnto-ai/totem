## Lesson — The lock flag goes before the git subcommand

**Tags:** git, mcp
**Scope:** packages/mcp/**/*.ts, !**/*.test.*, !**/*.spec.*

A read-only status read passes `--no-optional-locks` so git does not refresh and lock the index. It is a git-level option and goes before the subcommand: `git --no-optional-locks status`. Written after the subcommand git refuses it, and a caller that catches the failure reads the error as a clean tree. The `describe_project` state read uses the git-level spelling and a test holds it there (mmnto-ai/totem#3013).
