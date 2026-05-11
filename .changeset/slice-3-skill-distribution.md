---
'@mmnto/cli': minor
---

`totem init` now distributes the canonical `signoff` and `review-reply`
session-utility skills into `.claude/skills/<name>/SKILL.md` on the Claude
side, using marker-based replacement so canonical updates land everywhere
on subsequent `totem init` runs while user-authored content below the end
marker survives.

`totem eject` mirrors the install — removes only marker'd files, with
bottom-up pruning of empty `.claude/skills/<name>/` and `.claude/skills/`
directories. User-authored skill files (no markers) are preserved.

Phase C slice 3 (Closes `mmnto-ai/totem#1890`). Gemini parity for the same
two skills is tracked separately as `mmnto-ai/totem#1891` (slice 4).

The canonical content is single-sourced from
`mmnto-ai/totem:.claude/skills/<name>/SKILL.md` with an invariant test
that fails CI if the embedded constant ever drifts from the source.
