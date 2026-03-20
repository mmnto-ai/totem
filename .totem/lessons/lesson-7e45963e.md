## Lesson — Manually suppress "unused export" errors in styleguide

**Tags:** style, curated
**Pattern:** ^\+?\s*export\b(?!.*eslint-disable)
**Engine:** regex
**Scope:** **/styleguide/**/*.ts, **/styleguide/**/*.tsx, **/styleguide/**/*.js, **/styleguide/**/*.jsx, **/*.styleguide.ts, **/*.styleguide.tsx, **/*.styleguide.js, **/*.styleguide.jsx
**Severity:** warning
