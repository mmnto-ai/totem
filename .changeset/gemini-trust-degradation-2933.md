---
'@mmnto/cli': minor
---

`totem doctor` gains a `Gemini Workspace Trust` sensor row, and the managed reflex block names the CLI fallback for when the Totem MCP tools are absent (asks 2 and 3 of mmnto-ai/totem#2933).

- **Doctor row.** When the repository's `.gemini/settings.json` declares at least one MCP server, the row reads Gemini CLI's trust file (`~/.gemini/trustedFolders.json`) and reports `pass` when this folder is listed as trusted, `warn` when it is not listed or is marked `DO_NOT_TRUST` (Gemini CLI may then filter MCP servers, so the Totem MCP tools may be absent from a Gemini session; the remediation names the trust step and `totem search`), and `skip` with its reason when there is no Gemini MCP wiring or the trust file is absent, unreadable or unrecognised. It is a sensor: every result is gate-exempt, so it changes the exit of `doctor --strict` at neither tier. Limit: the trust file's shape was measured on Gemini CLI 0.61.0 on one machine; the reading of `TRUST_PARENT` and the value `DO_NOT_TRUST` come from Gemini CLI's documentation, so the row declines (`skip`) on anything it does not recognise.
- **Reflex block.** A new Memory Reflexes item: when `search_knowledge` or `add_lesson` is not in the agent's tool list, tell the user and use `totem search "<query>"` and `totem lesson add "<text>"` from the terminal. The reflex version is now 17, so an existing managed block reads as outdated until `totem init` is re-run.

Ask 1 of mmnto-ai/totem#2933 (a line on `describe` / `orient`) is not part of this change.
