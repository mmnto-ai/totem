## Lesson — Static analysis tools should read file content using git

**Tags:** style, curated
**Pattern:** \b(?:fs\.)?read(?:File|FileSync)\s*\(
**Engine:** regex
**Scope:** scripts/**/*.js, scripts/**/*.ts, tools/**/*.js, tools/**/*.ts
**Severity:** warning

Static analysis tools should read file content using git.
