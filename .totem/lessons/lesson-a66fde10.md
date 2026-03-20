## Lesson — Include a space or delimiter when concatenating disjoint

**Tags:** architecture, curated
**Pattern:** \$\{[^}]+\}\$\{[^}]+\}
**Engine:** regex
**Scope:** **/*.ts, **/*.js, **/*.tsx, **/*.jsx, **/*.sh, **/*.bash
**Severity:** error

Include a space or delimiter between concatenated fragments (e.g., '${a} ${b}') to prevent 'keyword synthesis' and bypass security filters.
