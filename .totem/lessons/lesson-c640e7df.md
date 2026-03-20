## Lesson — Avoid using console methods directly in core library

**Tags:** style, curated
**Pattern:** \bconsole\.(log|warn|error|info|debug|trace)\b
**Engine:** regex
**Scope:** packages/core/**/*.ts, libs/**/*.ts, !**/*.test.ts
**Severity:** warning

Avoid using console methods directly in core library.
