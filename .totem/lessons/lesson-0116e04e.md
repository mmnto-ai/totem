## Lesson — Trim raw spawn output in error messages

**Tags:** shell, formatting
**Scope:** packages/core/src/sys/**/*.ts, !**/*.test.*

Raw `stdout` and `stderr` from `safeExec` preserve trailing whitespace; always use a trimmed copy when formatting error messages. This prevents corrupted log output and maintains clean user-facing strings.
