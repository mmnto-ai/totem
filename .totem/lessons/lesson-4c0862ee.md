## Lesson — When injecting vectordb lessons into orchestrator prompts

**Tags:** style, curated
**Pattern:** \bif\s*\(.*?\b(budget|limit|max|capacity|length|chars)\b.*?\)\s*break\b
**Engine:** regex
**Scope:** **/orchestrator/**/*.ts, **/totem/**/*.ts, !**/*.test.ts
**Severity:** warning

When injecting vectordb lessons into orchestrator prompts.
