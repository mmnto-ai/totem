## Lesson — Re-thrown errors must preserve the original cause

**Tags:** error-handling, architecture, curated
**Pattern:** throw\s+new\s+\w*Error\([^)]*\+\s*(?:err|e|error)\.message
**Engine:** regex
**Scope:** **/*.ts, !**/*.test.ts, !**/*.spec.ts
**Severity:** warning

When catching and re-throwing errors, pass the original error as the ES2022 `cause` property instead of concatenating `.message` into a new string. Concatenation destroys the original stack trace, making debugging significantly harder. Use `throw new TotemError('context', 'hint', originalErr)` instead.
