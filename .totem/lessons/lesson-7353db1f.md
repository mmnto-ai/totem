## Lesson — Ensure model name validation regexes explicitly allow

**Tags:** style, curated
**Pattern:** \bmodel\w*\b.*(['"\/])\^?\[[a-zA-Z0-9\-_]+\][*+]\$?\1
**Engine:** regex
**Scope:** **/*.ts, **/*.js, **/*.tsx, **/*.jsx
**Severity:** warning

Model name validation regexes must explicitly allow dots (.) to accommodate naming schemes like gpt-5.4
