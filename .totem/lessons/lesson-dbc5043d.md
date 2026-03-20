## Lesson — Generating IDs from violation properties like file, line,

**Tags:** architecture, curated
**Pattern:** \bid\s*[:=]\s*.*\b(Date\.now|Math\.random|uuid|randomUUID)
**Engine:** regex
**Scope:** **/*.ts, **/*.js, !**/*.test.ts
**Severity:** error

Use deterministic IDs (based on file, line, and content) for violations to ensure stability across runs. Avoid non-deterministic values like timestamps or random numbers.
