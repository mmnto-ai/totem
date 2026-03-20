## Lesson — Casting an object literal to an Error type does not satisfy

**Tags:** style, curated
**Pattern:** \}\s*as\s+Error\b
**Engine:** regex
**Scope:** \*\*/*.ts, **/\*.tsx
**Severity:\*\* warning

Casting an object literal to an Error type does not satisfy 'instanceof Error' checks at runtime. Use 'Object.assign(new Error(message), properties)' instead.
