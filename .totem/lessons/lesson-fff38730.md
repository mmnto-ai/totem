## Lesson — Narrow catch blocks in test imports

**Tags:** testing, wasm
**Scope:** packages/core/src/ast-grep-wasm-shim.test.ts

When importing shims that might fail due to specific environment limits, only swallow the expected error signature to avoid masking real regressions.
