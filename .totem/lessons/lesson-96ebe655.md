## Lesson — Performing content.split('\n') inside a loop over line

**Tags:** architecture, curated
**Pattern:** \.split\(['"]\\n['"]\)\s*\[
**Engine:** regex
**Scope:** **/*.ts, **/*.tsx, **/*.js, **/*.jsx
**Severity:** error

Hoisting .split('\n') outside of loops prevents quadratic O(N^2) complexity. Avoid splitting the same string repeatedly to access lines by index.
