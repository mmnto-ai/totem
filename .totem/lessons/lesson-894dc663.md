## Lesson — Initialize WASM engines lazily

**Tags:** performance, wasm, dx
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Top-level WASM initialization adds overhead to every CLI command, including `help`. Move initialization to specific command handlers to improve startup performance and prevent unnecessary failures.
