## Lesson — Avoid using exit 0 inside git hooks intended for chaining

**Tags:** architecture, curated
**Pattern:** \bexit\s+0\b
**Engine:** regex
**Scope:** .husky/**/*, scripts/hooks/**/*, *.sh
**Severity:** error

Avoid using 'exit 0' in git hooks as it prevents hook chaining. Wrap logic in if/fi blocks instead to allow subsequent hooks to execute.
