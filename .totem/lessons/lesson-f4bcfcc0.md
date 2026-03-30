## Lesson — Static top-level imports in CLI command files increase

**Tags:** cli, performance, typescript

Static top-level imports in CLI command files increase startup latency. Use dynamic imports inside command handlers for heavy schemas or internal packages to maintain a fast runtime path.
