## Lesson — Treat usage and token statistics as optional fields

**Tags:** security, curated
**Pattern:** \busage\s*\.\s*(prompt_tokens|completion_tokens|total_tokens)\b
**Engine:** regex
**Scope:** **/*.ts, **/*.js, **/*.tsx, **/*.jsx, !**/*.test.ts
**Severity:** error

Treat usage and token statistics as optional fields.
