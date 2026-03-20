## Lesson — Using a unified "Totem Error" tag in error logs instead

**Tags:** style, curated
**Pattern:** ['"](?![^'"]*Totem Error)(?:\[[^\]]*Error\]|[\w-]+\s+Error:)
**Engine:** regex
**Scope:** **/\*.ts, **/_.tsx, \*\*/_.js, **/\*.jsx, **/_.py, \*\*/_.go
**Severity:** warning

Use the unified 'Totem Error' tag in error logs instead of command-specific identifiers (e.g., [Command Error] or 'Command Error:') to ensure consistent observability.
