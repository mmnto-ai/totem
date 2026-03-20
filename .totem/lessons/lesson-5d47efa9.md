## Lesson — Core library code should avoid direct calls to console

**Tags:** style, curated
**Pattern:** \bconsole\.(log|warn|error|info|debug|trace)\s*\(
**Engine:** regex
**Scope:** packages/core/**/*.ts, packages/core/**/*.js, !**/*.test.ts, !**/*.spec.ts
**Severity:** warning

Core library code should avoid direct calls to console.
