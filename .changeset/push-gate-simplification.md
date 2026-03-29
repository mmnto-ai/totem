---
"@mmnto/cli": patch
---

Push gate simplification (Proposal 206): rewrite pre-push hook as fast read-only checkpoint, add ancestry-aware lint validation with .target-globs cache, diagnostic hook output, and ticket-aware spec gate. totem lint now writes .lint-passed and .target-globs cache files for the hook.
