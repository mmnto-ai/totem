## Lesson — Export core types in WASM shims

**Tags:** typescript, wasm, ast-grep
**Scope:** packages/core/src/ast-grep-wasm-shim.ts

WASM shims replacing native NAPI modules must export equivalent core types (like SgRoot or SgNode) to prevent type-checking failures in downstream consumers.
