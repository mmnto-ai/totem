## Lesson — Prefer replacer functions over back-references

**Tags:** regex, security, javascript
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Using a replacer function instead of a string back-reference (like `$&`) avoids unintended interpretation of special sequences in substitution-sensitive contexts.
