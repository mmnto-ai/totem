## Lesson — 2026-03-07T06:05:56.069Z

**Tags:** security, curated
**Pattern:** typeof\s+[^\s!&|=]+\s*===\s*['"]object['"](?!\s*&&)
**Engine:** regex
**Scope:** **/*.ts, **/*.tsx, **/*.js, **/*.jsx, !**/*.test.ts
**Severity:** error

Do not sanitize or XML-wrap semi-trusted metadata like branch names or git file paths in prompts to avoid unnecessary clutter (Totem principle).
