## Lesson — Restrict property regex to member-access contexts

**Tags:** regex, javascript, eslint
**Scope:** packages/core/src/eslint-adapter.ts

When converting property restrictions to regex, patterns must explicitly match dot or bracket notation (e.g., `obj.prop` or `obj['prop']`). This prevents false positives where a forbidden property name appears as a standalone variable or part of a different identifier.
