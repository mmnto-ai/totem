## Lesson — Detect project roots via local existence

**Tags:** git, filesystem
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Use `fs.existsSync` to check for `.git` in the current directory; this correctly identifies both standard directories and the `.git` files used in worktrees, while avoiding incorrect parent-repo detection from traversal helpers.
