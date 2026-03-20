## Lesson — 2026-03-08T02:39:04.901Z

**Tags:** style, curated
**Pattern:** \.(toBeGreaterThan|toBeGreaterThanOrEqual)\(
**Engine:** regex
**Scope:** **/*.test.ts, **/*.test.js, **/*.spec.ts, **/*.spec.js
**Severity:** warning

Use exact count assertions (e.g., .toHaveLength() or .toBe()) instead of 'greater than' checks to detect accidental deletions in fixed sets.
