## Lesson — Generating IDs from violation properties like file, line,

**Tags:** architecture, curated
**Pattern:** \bid\s*[:=]\s*.*\b(Date\.now|Math\.random|uuid|randomUUID)
**Engine:** regex
**Scope:** **/*.ts, **/*.js, !**/*.test.ts
**Severity:** error

Generating IDs from violation properties like file, line.
