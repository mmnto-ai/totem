## Lesson — 2026-03-06T18:48:00.895Z

**Tags:** architecture, curated
**Pattern:** \bnode\s+[^"'\s]+\.js\b
**Engine:** regex
**Scope:** package.json, **/\*.sh, Makefile
**Severity:\*\*\*\* error

Use the .cjs extension for utility scripts and host integration hooks in ESM-first projects to ensure compatibility with external tools and prevent module resolution errors.
