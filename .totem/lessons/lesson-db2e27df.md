## Lesson — 2026-03-06T04:31:54.888Z

**Tags:** style, curated
**Pattern:** \b(totem\s+learn|learn\()
**Engine:** regex
**Scope:** **/triage/**, **/triage.\*, !**/\*.test.ts
**Severity:** warning

Keep 'triage' and 'learn' decoupled to maintain modularity. Do not invoke 'learn' from within 'triage' logic; use 'totem run <workflow>' for composition instead.
