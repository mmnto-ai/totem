## Lesson — Use shell-safe snippets for timeout tests

**Tags:** testing, node, windows
**Scope:** packages/core/src/sys/**/*.ts, !**/*.test.*, !**/*.spec.*

Use `setInterval(Object, ms)` instead of arrow functions in spawned Node commands to avoid shell-sensitive characters like `=>` that trigger redirection on Windows.
