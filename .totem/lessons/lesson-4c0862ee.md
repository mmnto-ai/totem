## Lesson — When injecting vectordb lessons into orchestrator prompts

**Tags:** style, curated
**Pattern:** \bif\s*\(.*?\b(budget|limit|max|capacity|length|chars)\b.*?\)\s*break\b
**Engine:** regex
**Scope:** **/orchestrator/**/*.ts, **/totem/**/*.ts, !**/*.test.ts
**Severity:** warning

Use 'continue' instead of 'break' in character budget loops so oversized items are skipped but smaller ones still fit.
