## Lesson — 2026-03-06T18:48:00.895Z

**Tags:** architecture, curated
**Pattern:** \bnode\s+[^"'\s]+\.js\b
**Engine:** regex
**Scope:** package.json, **/*.sh, Makefile
**Severity:** error

Use the package.json bin entry or pnpm exec instead of raw node path.js invocations.
