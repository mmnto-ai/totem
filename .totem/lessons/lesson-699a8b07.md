## Lesson — 2026-03-03T01:51:33.783Z

**Tags:** architecture, curated
**Pattern:** \.(includes|match|indexOf|search)\(\s*['"`].*-o\s+json._['"`]\s_\)
**Engine:** regex
**Scope:** **/\*.ts, **/_.js, \*\*/_.py, **/\*.sh
**Severity:\*\*\*\* error

Use try-parse on stdout rather than string-matching the command for '-o json'. This handles edge cases and doesn't require config awareness.
