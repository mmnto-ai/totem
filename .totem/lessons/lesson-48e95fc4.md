## Lesson — Static analysis tools should read file content using git

**Tags:** style, curated
**Pattern:** \b(?:fs\.)?read(?:File|FileSync)\s*\(
**Engine:** regex
**Scope:** scripts/**/*.js, scripts/**/*.ts, tools/**/*.js, tools/**/*.ts
**Severity:** warning

Static analysis tools should read file content using 'git show :path' to access the staged index version instead of reading from the local disk.
