## Lesson — 2026-03-08T02:39:04.901Z

**Tags:** style, curated
**Pattern:** \.message\.(includes|startsWith|match)\s*\(|\.message\s*(===?|!==?)\s*['"`]
**Engine:** regex
**Scope:** **/*.ts, **/*.js, !**/*.test.ts, !**/*.spec.ts
**Severity:** warning

Use named error objects (e.g., err.name = 'NoDocsConfiguredError') instead of string matching on err.message to handle expected conditions.
