## Lesson — CLI command entrypoints should catch validation errors

**Tags:** style, curated
**Pattern:** \bthrow\s+new\s+(?!Totem)\w*Error\(
**Engine:** regex
**Scope:** packages/cli/**/*.ts, !**/*.test.ts
**Severity:** warning
