## Lesson — Standardize exception messages with a consistent prefix

**Tags:** architecture, curated
**Pattern:** \bnew\s+\w*Error\(\s*['"`](?!\[Totem Error\])
**Engine:** regex
**Scope:** **/\*.ts, **/_.js, !\*\*/_.test.ts
**Severity:** error

Exception messages must start with the '[Totem Error]' prefix to help distinguish internal logic failures from external system errors.
