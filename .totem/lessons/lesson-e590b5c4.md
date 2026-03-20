## Lesson — 2026-03-08T00:11:33.219Z

**Tags:** architecture, curated
**Pattern:** process\.env\.[A-Z0-9_]+\s*(?:!==|!=)\s*(?:undefined|null|['"]['"])
**Engine:** regex
**Severity:** error

Environment variable checks must validate non-whitespace characters (/\S/.test()) to prevent false positives from empty strings.
