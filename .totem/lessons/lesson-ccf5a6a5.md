## Lesson — 2026-03-06T03:36:17.521Z

**Tags:** architecture, curated
**Pattern:** \.(where|delete)\s*\(\s*(?:'[^']_"[^"]+"[^']_'|"[^"]_\\"[^"]+\\"[^"]_"|`[^`]_"[^"]+"[^`]_`)\s*\)
**Engine:** regex
**Scope:** packages/core/\*\*/*.ts, !**/\*.test.ts
**Severity:\*\*\*\* error

Use backticks (`) for column identifiers in LanceDB filters; double quotes (") cause silent failures in DataFusion.
