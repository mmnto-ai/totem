## Lesson — Sanitize git-sourced metadata like branch names, status,

**Tags:** security, curated
**Pattern:** \bgit\s+(?:branch|status|diff|log|describe|show)\b(?!._(?:stripAnsi|replace|sed|tr|\|))
**Engine:** regex
**Scope:** \*\*/_.ts, **/\*.js, **/_.sh, \*\*/_.bash
**Severity:** error

Sanitize git-sourced metadata (branch, status, diff) to remove ANSI escape sequences and control characters.
