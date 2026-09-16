## Lesson — Respect existing file line terminators

**Tags:** formatting, git, cross-platform
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

When programmatically editing files, detect and use the file's existing line terminators (LF or CRLF) to prevent dirty git diffs and unnecessary writes.
