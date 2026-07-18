## Lesson — Defer heavy imports to error paths

**Tags:** cli, performance, imports
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

To maintain fast CLI startup latency, avoid static imports of heavy dependencies or domain-specific errors in command handlers. Instead, load them via dynamic imports only when entering the error throw path.
