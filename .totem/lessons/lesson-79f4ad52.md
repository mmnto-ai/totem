## Lesson — Sanitize user-provided text before persisting to files

**Tags:** security, curated
**Pattern:** \b(?:write|append)File(?:Sync)?\s*\(\s*['"][^'"]_\.(?:md|log)['"]\s_,\s*(?![^,]*\b(?:stripAnsi|sanitize|replace)\b)[^,)\s]+
**Engine:** regex
**Scope:** **/\*.ts, **/_.js, \*\*/_.tsx, **/\*.jsx
**Severity:\*\*\*\* error

Sanitize ANSI escape sequences (e.g., using 'stripAnsi') before persisting text to Markdown or log files to prevent terminal injection vulnerabilities.
