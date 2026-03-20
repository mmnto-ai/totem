## Lesson — Ensure all thrown errors, including those for missing

**Tags:** style, curated
**Pattern:** throw\s+.*['"`](?!\s*\[Totem Error\])
**Engine:** regex
**Scope:** **/*.ts, **/*.js, **/*.tsx, **/*.jsx, **/*.mjs, **/*.cjs
**Severity:** warning

All thrown errors must strictly include the '[Totem Error]' prefix for consistent reporting and monitoring.
