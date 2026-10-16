---
'@mmnto/cli': patch
---

`totem init` stamps `gemini-3.8-flash` into a generated config for the Gemini CLI branch (a shell provider running the `gemini` binary) and the `GEMINI_API_KEY` / `GOOGLE_API_KEY` branch (the SDK provider), instead of `gemini-3.5-flash`. The Gemini API auto-routes the old id to `gemini-3.6-flash`, and the Gemini CLI rewrites it to `gemini-3.8-flash` only under its latest-flash GA flag (else it passes through, or maps to `gemini-3-flash` on Code Assist), so a consumer config stamped with it named a model no path served as written; the new id is the current GA flash (released 2026-09-02, no shutdown date announced) on both tables. No other generated default moves, and no gate or hook behaviour changes (mmnto-ai/totem#3088).
