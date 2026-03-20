## Lesson — 2026-03-08T02:39:04.901Z

**Tags:** style, curated
**Pattern:** \.(toBeGreaterThan|toBeGreaterThanOrEqual)\(
**Engine:** regex
**Scope:** **/*.test.ts, **/*.test.js, **/*.spec.ts, **/*.spec.js
**Severity:** warning

Prefer sequential for...of loops over Promise.all for background maintenance tasks to simplify error isolation and allow per-item error handling.
