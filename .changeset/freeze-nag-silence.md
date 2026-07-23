---
'@mmnto/cli': patch
---

Suppress the lesson-staleness `Run 'totem lesson compile'` advisory in `totem lint` while a rule-compilation freeze is active, since that command is on the freeze's do-not list (mmnto-ai/totem#2463 slice B). The nag is silenced only on a positive frozen=true; any freeze-state read failure falls through to showing the advisory as before.
