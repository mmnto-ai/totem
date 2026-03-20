## Lesson — Use granular assertions rather than snapshots when testing

**Tags:** architecture, curated
**Pattern:** \.toMatch(Inline)?Snapshot\s*\(
**Engine:** regex
**Scope:** \*\*/*.test.ts, **/\*.test.js, **/_.test.tsx, \*\*/_.test.jsx, **/\*.spec.ts, **/_.spec.js, \*\*/_.spec.tsx, **/\*.spec.jsx
**Severity:\*\*\*\* error

Use granular assertions rather than snapshots when testing system prompts to avoid test fragility from non-functional prose changes.
