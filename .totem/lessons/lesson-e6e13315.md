## Lesson — Implement graceful degradation for optional engines

**Tags:** architecture, dx
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*

When a heavy dependency like a WASM AST engine is unavailable, the system should skip dependent features with a warning rather than crashing. This allows 'lite' binaries to remain functional for non-AST tasks.
