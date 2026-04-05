## Lesson — Implement graceful degradation for optional engines

**Tags:** architecture, error-handling
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

In restricted 'lite' environments, skip AST-based rules with a warning instead of crashing if the WASM engine is unavailable. This ensures the CLI remains functional for regex-based rules.
