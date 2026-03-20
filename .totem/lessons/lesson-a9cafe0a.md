## Lesson — Explicit type assertions are often unnecessary when using

**Tags:** architecture, curated
**Pattern:** \?\?\s*(['"][^'"]*['"]|\d+|true|false)\s+as\s+
**Engine:** regex
**Scope:** **/*.ts, **/*.tsx
**Severity:** warning

Explicit type assertions are unnecessary when using the nullish coalescing operator (??) with a literal fallback, as TypeScript infers the narrowest type automatically.
