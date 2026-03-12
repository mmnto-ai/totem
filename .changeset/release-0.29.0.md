---
'@mmnto/cli': minor
'@mmnto/totem': patch
'@mmnto/mcp': patch
---

Lesson injection into all orchestrator commands, totem audit, and Junie docs.

- **`totem audit`** — strategic backlog audit with human approval gate, interactive multi-select, shell injection prevention via `--body-file`, resilient batch execution (#362)
- **Lesson injection** — vector DB lessons now injected into shield (full bodies), triage (condensed), and briefing (condensed) via shared `partitionLessons()` + `formatLessonSection()` helpers (#370)
- **Junie docs** — MCP config example and export target docs in README (#371)
- **Lesson ContentType** — `add_lesson` MCP tool now uses `lesson` content type for better vector DB filtering (#377)
- **Versioned reflex upgrade** — `REFLEX_VERSION=2` with `detectReflexStatus()` and `upgradeReflexes()` for existing consumers (#375)
- **Spec lesson injection** — lessons injected as hard constraints into `totem spec` output (#366)
