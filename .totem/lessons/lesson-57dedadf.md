## Lesson — Using a boolean flag to track lazy initialization causes

**Tags:** architecture, curated
**Pattern:** \b(?:is)?[iI]nitialized\s*(?::\s*boolean|=\s*(?:true|false))\b
**Engine:** regex
**Scope:** **/*.ts, **/*.tsx, **/*.js, **/*.jsx
**Severity:** warning

Avoid using boolean flags for lazy initialization. Use a Promise to track initialization to prevent race conditions during concurrent calls (e.g., Promise.all).
