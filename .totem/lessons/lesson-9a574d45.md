## Lesson — 2026-03-07T06:05:56.069Z

**Tags:** architecture, curated
**Pattern:** typeof\s+[^\s!&|=]+\s*===\s*['"]object['"](?!\s*&&)
**Engine:** regex
**Severity:** error

Always combine 'typeof val === "object"' with a truthiness check (e.g., 'val && typeof val === "object"') because 'typeof null' is 'object'.
