## Lesson — 2026-03-08T02:39:04.901Z

**Tags:** style, curated
**Pattern:** \.(toBeGreaterThan|toBeGreaterThanOrEqual)\(
**Engine:** regex
**Scope:** **/*.test.ts, **/*.test.js, **/*.spec.ts, **/*.spec.js
**Severity:** warning

Use named error objects (e.g., err.name = 'NoDocsConfiguredError') instead of string matching on err.message to handle expected conditions.
