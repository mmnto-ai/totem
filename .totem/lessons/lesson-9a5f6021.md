## Lesson — Avoid shell metacharacters in exec arguments

**Tags:** windows, shell, security
**Scope:** packages/core/src/sys/**/*.ts, !**/*.test.*, !**/*.spec.*

On Windows, `shell: true` causes `cmd.exe` to re-parse command strings, where tokens like `=>` are misinterpreted as output redirection (`>`), potentially creating stray files.
