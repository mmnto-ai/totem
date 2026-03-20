## Lesson — Manually suppress "unused export" errors in styleguide

**Tags:** style, curated
**Pattern:** ^\+?\s*export\b(?!.*eslint-disable)
**Engine:** regex
**Scope:** **/styleguide/**/_.ts, **/styleguide/**/_.tsx, **/styleguide/**/_.js, **/styleguide/**/_.jsx, **/\*.styleguide.ts, **/_.styleguide.tsx, \*\*/_.styleguide.js, **/\*.styleguide.jsx
**Severity:\*\*\*\* warning

Manually suppress 'unused export' errors in styleguide files (e.g., using // eslint-disable-line) as these are consumed by AI tools and not internal imports.
