---
'@mmnto/totem': patch
'@mmnto/cli': patch
---

Bug blitz: four fixes from triage priorities.

- **#396:** Anthropic orchestrator uses model-aware max_tokens (Haiku 4K, Sonnet 8K, Opus 16K)
- **#397:** matchesGlob now supports single-star directory patterns (e.g., `src/*.ts`)
- **#398:** extractChangedFiles handles quoted paths with spaces
- **#399:** AST gate reads staged content (`git show :path`) before falling back to disk
