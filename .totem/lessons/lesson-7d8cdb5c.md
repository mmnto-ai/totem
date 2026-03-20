## Lesson — 2026-03-06T09:08:26.567Z

**Tags:** architecture, curated
**Pattern:** "(hook|PreToolUse|command|scripts?)":\s*\"[^\"]*(\\||\\b(grep|awk|sed|xargs)\\b|&&)[^\"]*\"
**Engine:** regex
**Scope:** *.json
**Severity:** error

Hook configurations must not contain shell injection patterns (pipes, grep, etc.).
