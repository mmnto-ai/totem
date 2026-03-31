---
'@mmnto/cli': patch
---

feat: structured session checkpoints for totem handoff (#914)

`totem handoff` now emits a Zod-validated JSON checkpoint alongside the Markdown output. Deterministic fields (branch, active_files) come from git; semantic fields (completed, remaining, pending_decisions, context_hints) are parsed from the LLM Markdown. Lite mode gracefully degrades with empty semantic arrays. Checkpoint writes are atomic (tmp+rename).
