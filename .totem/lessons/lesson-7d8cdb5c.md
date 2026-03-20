## Lesson — 2026-03-06T09:08:26.567Z

**Tags:** architecture, curated
**Pattern:** "(hook|PreToolUse|command|scripts?)":\s*\"[^\"]*(\\||\\b(grep|awk|sed|xargs)\\b|&&)[^\"]*\"
**Engine:** regex
**Scope:** *.json
**Severity:** error

Avoid embedding complex shell pipelines in JSON configuration; extract hook logic into a dedicated script file (e.g., .gemini/hooks/BeforeTool.js) for maintainability.
