---
'@mmnto/cli': minor
'@mmnto/totem': minor
---

1.12.0 — The Umpire & The Router

- Standalone binary: lite-tier distribution works without Node.js, using @ast-grep/wasm for full AST rule coverage across linux-x64, darwin-arm64, win32-x64
- Ollama auto-detection: `totem init` detects local Ollama and defaults to gemma4 for classification
- ast-grep for ESLint properties: `no-restricted-properties` import uses precision AST matching
- Lazy WASM init: AST engine only initializes when lint/test commands need it
- GHA injection rule scope: narrowed to `run:` contexts, no false positives in `env:`/`with:` blocks
- Windows CI stability: fixed flaky orchestrator timeout
