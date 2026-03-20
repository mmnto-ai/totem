## Lesson — 2026-03-03T01:52:20.000Z

**Tags:** style, curated
**Pattern:** \b(main|master)\.\.\.HEAD\b
**Engine:** regex
**Scope:** **/\*.ts, **/_.js, \*\*/_.sh
**Severity:** warning

Use getDefaultBranch() to dynamically detect the base branch instead of hardcoding 'main' or 'master' in diff strings (e.g., main...HEAD).
