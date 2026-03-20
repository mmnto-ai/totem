## Lesson — Sanitize git-sourced metadata like branch names, status,

**Tags:** security, curated
**Pattern:** \bgit\s+(?:branch|status|diff|log|describe|show)\b(?!.*(?:stripAnsi|replace|sed|tr|\|))
**Engine:** regex
**Scope:** **/*.ts, **/*.js, **/*.sh, **/*.bash
**Severity:** error
