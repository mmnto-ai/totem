---
'@mmnto/cli': patch
---

`totem init` stamps `gemini-3.8-flash` into a generated config for the Gemini CLI and `GEMINI_API_KEY` environments, instead of `gemini-3.5-flash`. The Gemini API auto-routes the old id to `gemini-3.6-flash` and the Gemini CLI rewrites it to `gemini-3.8-flash`, so a consumer config stamped with it named a model neither path served as written; the new id is the current GA flash (released 2026-09-02, no shutdown date announced). No other generated default moves, and no gate or hook behaviour changes (mmnto-ai/totem#3088).
