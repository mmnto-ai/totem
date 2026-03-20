## Lesson — Using split() on markdown headings often misclassifies

**Tags:** architecture, curated
**Pattern:** \.split\(\s*(?:\/\^?#+|['"]\^?#+)
**Engine:** regex
**Scope:** \*\*/*.ts, **/\*.js, **/_.tsx, \*\*/_.jsx
**Severity:** warning

Avoid using split() on markdown headings as it often misclassifies content or loses heading text. Use matchAll() to capture heading indices for precise slicing.
