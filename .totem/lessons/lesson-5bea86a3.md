## Lesson — Check for the presence of the 'g' flag before appending it

**Tags:** architecture, curated
**Engine:** ast-grep
**Severity:** warning
**Scope:** **/*.ts, **/*.js, !**/*.test.ts
**Pattern:** `new RegExp($SRC, $FLAGS + 'g')`

Check for the presence of the 'g' flag before appending it.
