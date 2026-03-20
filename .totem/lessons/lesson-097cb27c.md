## Lesson — Synchronous execSync with piped stdio can cause the parent

**Tags:** style, curated
**Pattern:** \bexecSync\s*\(
**Engine:** regex
**Scope:** **/*.ts, **/*.js, **/*.tsx, **/*.jsx, !.gemini/hooks/**, !.totem/hooks/**, !tools/**
**Severity:** warning

Synchronous execSync with piped stdio can cause the parent.
