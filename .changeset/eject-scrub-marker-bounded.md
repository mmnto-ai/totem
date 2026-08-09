---
'@mmnto/cli': patch
---

fix(eject): the reflex scrub is marker-bounded and covers the full tool-table roster (mmnto-ai/totem#2602). On marker-bearing files (v2+ blocks) `totem eject` now removes exactly the `REFLEX_START..REFLEX_END` span with the same single-owner seam discipline regen uses, preserving the after-end-marker span that is contractually user content — the previous heading-to-EOF regex deleted that span and left an orphan start+version pair that read as `current`. A file with an incomplete marker pair is left byte-untouched and reported, never heading-scrubbed. The heading-to-EOF path survives only for legacy no-marker blocks. The scrub roster is now derived from the same `AI_TOOLS` table init injects through — the hardcoded pair silently skipped `GEMINI.md`, `.junie/guidelines.md`, and `.github/copilot-instructions.md`.
