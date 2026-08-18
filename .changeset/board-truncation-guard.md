---
'@mmnto/cli': patch
---

`totem orient`: the board section no longer silently truncates GH Project boards above 200 cards. The board fetch now uses a deliberately complete `--limit 1000` and validates the response against the board's own `totalCount` — any shortfall surfaces as a loud per-section `{ error }` (and propagates to the coherence sensor) instead of rendering a partial board as complete. (mmnto-ai/totem#2644)
