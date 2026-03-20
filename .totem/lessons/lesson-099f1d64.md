## Lesson — Swallowing errors in core modules hides silent failures,

**Tags:** architecture, curated
**Pattern:** \bconsole\.(log|warn|error|info|debug)\(
**Engine:** regex
**Scope:** **/core/**/*.ts, **/core/**/*.js, !**/*.test.ts
**Severity:** warning

Swallowing errors in core modules hides silent failures.
