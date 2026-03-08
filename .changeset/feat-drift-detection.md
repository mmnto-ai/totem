---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

feat: drift detection for self-cleaning memory (#181)

Adds `totem sync --prune` to detect and interactively remove lessons with stale file references. The drift detector scans `.totem/lessons.md` for backtick-wrapped file paths that no longer exist in the project, then presents an interactive multi-select for pruning. After pruning, the vector index is automatically re-synced.

New core exports: `parseLessonsFile`, `extractFileReferences`, `detectDrift`, `rewriteLessonsFile`.
