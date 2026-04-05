## Lesson — Guard against broad error swallowing

**Tags:** testing, wasm, typescript
**Scope:** packages/core/src/ast-grep-wasm-shim.test.ts

In async import tests, inspect caught errors to only swallow expected environment-specific failures while re-throwing actual regressions or unexpected import errors.
