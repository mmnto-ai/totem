---
'@mmnto/cli': minor
---

Add `totem bridge`, `totem eject`, and `totem wrap` commands

- **`totem bridge`** — Lightweight, no-LLM context bridge for mid-session compaction. Captures git branch, modified files, and optional breadcrumb message.
- **`totem eject`** — Clean reversal of `totem init`: scrubs git hooks, AI reflex blocks, Claude/Gemini hook files, and deletes Totem artifacts. Confirmation prompt with `--force` bypass.
- **`totem wrap <pr-numbers...>`** — Post-merge workflow automation: chains `learn → sync → triage` with interactive TTY for lesson confirmation.
