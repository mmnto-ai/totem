---
'@mmnto/totem': patch
---

transport-shield: the `msys-body-slash` row now reads the `gh` call inside a command substitution, a backtick, a brace group or after a shell reserved word (the 2026-10-16 trigger was posted from `u1=$(gh pr comment … --body '/gemini review')`, which the row never reached while the gate ran), and also refuses a `gh api` or `gh workflow run` field value (`-F`/`--field` typed, `-f`/`--raw-field` raw, the glued `-fX`) that MSYS would convert: a slash after `=`, `="` or `=(` before the value's first whitespace (`-f body=/gemini review` posts the Git install path exactly as `--body` did; `body=k=/v` too), and a raw `-f key=@/path`. A typed `-F key=@/path` file reference converts to the right Windows path and stays allowed, as does a `=/` after the first whitespace, which MSYS leaves alone. `gh.exe` reads as `gh`. The cure line is unchanged (`--body-file`, the PowerShell tool, or `MSYS_NO_PATHCONV=1`). Part of mmnto-ai/totem#2696.
