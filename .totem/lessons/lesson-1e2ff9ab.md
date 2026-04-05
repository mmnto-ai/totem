## Lesson — Avoid blind catches in engine fallbacks

**Tags:** error-handling, wasm
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

When implementing fallbacks for missing engines, verify the error is specifically related to initialization (e.g., `LinkError` or 'WASM' in message). Blindly catching all errors can hide unrelated architectural defects.
