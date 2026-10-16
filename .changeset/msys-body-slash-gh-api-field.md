---
'@mmnto/totem': patch
---

transport-shield: the `msys-body-slash` row also refuses a `gh api` field value that begins with a slash (`-f`, `--field`, `-F`, `--raw-field` carrying `key=/…`) under the Bash tool on win32. Measured 2026-10-16: MSYS converts the part after the `=`, so `-f body=/gemini review` posts the Git install path exactly as `--body '/gemini review'` did, and the row covered only `--body`. A `key=@/path` file reference converts to the right Windows path and stays allowed; the cure line is unchanged (`--body-file`, the PowerShell tool, or `MSYS_NO_PATHCONV=1`). Part of mmnto-ai/totem#2696.
