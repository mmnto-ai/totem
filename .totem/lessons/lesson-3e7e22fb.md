## Lesson — 2026-03-07T06:05:56.069Z

**Tags:** security, curated
**Pattern:** typeof\s+[^\s!&|=]+\s*===\s*['"]object['"](?!\s*&&)
**Engine:** regex
**Scope:** **/*.ts, **/*.tsx, **/*.js, **/*.jsx, !**/*.test.ts
**Severity:** error

Escape closing XML tags in prompts using backslash (e.g., <\/tag>) to prevent injection.
