## Lesson — Lazy load WASM for CLI performance

**Tags:** performance, wasm
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*

Initialize heavy engines like WASM only when required by specific commands rather than at top-level startup. This prevents unnecessary overhead and latency for simple CLI operations that do not require AST parsing.
