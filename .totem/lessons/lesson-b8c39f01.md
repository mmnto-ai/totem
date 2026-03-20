## Lesson — 2026-03-06T18:48:00.895Z

**Tags:** security, curated
**Pattern:** <\/[a-zA-Z0-9\${]
**Engine:** regex
**Scope:** **/\*.ts, **/_.js, !\*\*/_.test.ts, !**/\*.tsx
**Severity:\*\*\*\* error

When matching or escaping closing XML tags, use a case-insensitive regex that accounts for optional internal whitespace (e.g., /<\/\s*tag\s*>/i). Literal matches like '</tag>' or whitespace-rigid regexes are easily bypassed by LLMs/parsers and lead to prompt injection vulnerabilities.
