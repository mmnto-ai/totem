## Lesson — Handle dollar signs in identifier boundaries

**Tags:** regex, javascript
**Scope:** packages/core/src/eslint-adapter.ts

Standard word boundaries (`\b`) fail for JavaScript identifiers containing `$`. Using `(?:^|[^\w$])` as a prefix ensures that regex patterns correctly isolate identifiers without failing on valid special characters common in JS libraries.
