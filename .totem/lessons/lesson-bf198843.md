## Lesson — Ensure all thrown errors, including those for missing

**Tags:** style, curated
**Pattern:** throw\s+._['"`](?!\s_\[Totem Error\])
**Engine:** regex
**Scope:** **/\*.ts, **/_.js, \*\*/_.tsx, **/\*.jsx, **/_.mjs, \*\*/_.cjs
**Severity:** warning

All thrown errors must strictly include the '[Totem Error]' prefix for consistent reporting and monitoring.
