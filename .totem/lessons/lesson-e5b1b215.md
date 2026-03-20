## Lesson — Treat usage and token statistics as optional fields

**Tags:** security, curated
**Pattern:** \busage\s*\.\s*(prompt_tokens|completion_tokens|total_tokens)\b
**Engine:** regex
**Scope:** **/*.ts, **/*.js, **/*.tsx, **/*.jsx, !**/*.test.ts
**Severity:** error

Usage and token statistics should be treated as optional for OpenAI-compatible orchestrators. Use optional chaining (e.g., usage?.total_tokens) to prevent crashes when using third-party providers that omit this metadata.
