## Lesson — When re-throwing errors in a CLI orchestrator, always

**Tags:** style, curated
**Pattern:** throw\s+new\s+Error\(\s*['"\`](?![^'"\`]*\[Totem Error\])
**Engine:** regex
**Scope:** packages/cli/**/*.ts
**Severity:** warning

When re-throwing errors in a CLI orchestrator, always.
