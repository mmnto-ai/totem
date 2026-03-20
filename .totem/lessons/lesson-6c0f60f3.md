## Lesson — When identifying directory-based glob patterns (like

**Tags:** architecture, curated
**Pattern:** \.(includes\(['"]/['"]\)(?!\s*,\s*1)|indexOf\(['"]/['"]\)\s*(?:>=?\s*0|!==\s*-1))
**Engine:** regex
**Scope:** **/*.ts, **/*.js
**Severity:** error

When identifying directory-based globs, ensure the separator check excludes index 0 (e.g., use .includes('/', 1) or .indexOf('/') > 0) to avoid misinterpreting root-anchored paths as relative.
