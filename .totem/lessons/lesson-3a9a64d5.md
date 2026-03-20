## Lesson — Using child.kill() on Windows when shell: true is enabled

**Tags:** style, curated
**Pattern:** \.kill\(
**Engine:** regex
**Scope:** **/*.ts, **/*.js, **/*.tsx, **/*.jsx
**Severity:** warning

Avoid using .kill() on Windows when shell: true is enabled as it leaves zombie processes. Use 'taskkill /T /F' to terminate the entire process tree.
