## Lesson — 2026-03-06T10:00:40.352Z

**Tags:** style, curated
**Pattern:** grep\s+[^&|]*['"]git\s+(push|commit|pull|checkout|clone|reset|rebase|merge|branch|add)
**Engine:** regex
**Scope:** *.sh, *.bash, packages/mcp/**/*.ts, packages/cli/**/*.ts, .github/workflows/*.yml
**Severity:** warning

Avoid single-regex git command interception; use a dual-grep approach (e.g., grep 'git' && grep -E 'push|commit') for better platform and JSON-encoded argument compatibility.
