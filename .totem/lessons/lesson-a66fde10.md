## Lesson — Include a space or delimiter when concatenating disjoint

**Tags:** architecture, curated
**Pattern:** (\$\{[^}]+\}\$\{[^}]+\}|\.join\(['"]{2}\))
**Engine:** regex
**Scope:** **/*.ts, **/*.js, **/*.tsx, **/*.jsx
**Severity:** error

Include a space or delimiter between concatenated fragments (e.g., '${a} ${b}') to prevent 'keyword synthesis' and bypass security filters.
