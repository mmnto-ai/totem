## Lesson — Explicit type assertions are often unnecessary when using

**Tags:** typescript, typing

Explicit type assertions are often unnecessary when using the nullish coalescing operator (`??`) with a literal fallback. TypeScript's inference engine automatically resolves the type to the narrowest possible union, so adding `as 'type'` creates redundant code.
