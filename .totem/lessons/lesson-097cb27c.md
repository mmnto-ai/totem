## Lesson — Synchronous execSync with piped stdio can cause the parent

**Tags:** style, curated
**Pattern:** \bexecSync\s*\(
**Engine:** regex
**Scope:** **/*.ts, **/*.js, **/*.tsx, **/*.jsx, !.gemini/hooks/**, !.totem/hooks/**, !tools/**
**Severity:** warning

Use asynchronous spawn instead of execSync to avoid potential process hangs and silent failures.
