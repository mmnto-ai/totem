## Lesson — 2026-03-06T10:00:40.352Z

**Tags:** style, curated
**Pattern:** \b(echo|run_shell_command|exec|sh|bash)\b.*\$TOOL_INPUT
**Engine:** regex
**Scope:** *.sh, _.bash, _.yml, \*.yaml
**Severity:** error

Avoid single-regex git command interception; use a dual-grep approach (e.g., grep 'git' && grep -E 'push|commit') for better platform and JSON-encoded argument compatibility.
