---
'@mmnto/cli': minor
---

feat: `shield --learn` extracts lessons from failed verdicts (#303) and reduces false positives in suspicious lesson detection (#302)

**Shield --learn:** When a Shield LLM verdict fails, passing `--learn` runs a second extraction pass to distill systemic architectural lessons from the review. Supports `--yes` for unattended CI use (suspicious lessons are auto-dropped). Lessons are appended to `.totem/lessons.md` and immediately re-indexed.

**False positive reduction:** The instructional leakage heuristic now requires an attack verb (ignore, disregard, reveal, etc.) in proximity to a sensitive target (system prompt, previous instructions, etc.), preventing false positives on educational lessons that merely discuss security patterns.
