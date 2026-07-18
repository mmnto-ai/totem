---
'@mmnto/cli': patch
---

The signoff skill's repo→agent-id basename map gains a Kimi vendor column (`totem-kimi` seated in `totem`; other repos marked not-seated) — the fifth vendor lane per the 2026-07-18 operator ruling recorded in cohort-roles §1.4 (mmnto-ai/totem-strategy#930). Constant and the distributed copy in this repo updated in byte-sync; other repos pick the table up on their next `totem init` refresh. Seat discovery itself needed no code change — `.totem/orchestration/totem-kimi/` self-registers via the dirs-union layer (the #2141 vendor+1 invariant, live-tested by this seating).
