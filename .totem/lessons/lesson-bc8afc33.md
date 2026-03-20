## Lesson — 2026-03-07T06:05:56.069Z

**Tags:** security, curated
**Pattern:** typeof\s+[^\s!&|=]+\s*===\s*['"]object['"](?!\s*&&)
**Engine:** regex
**Scope:** **/*.ts, **/*.tsx, **/*.js, **/*.jsx, !**/*.test.ts
**Severity:** error

Avoid generic line-matching patterns like startsWith('(') when scrubbing auto-generated sections. Use precise line matches or unique block markers to prevent accidental removal of user-added logic.
