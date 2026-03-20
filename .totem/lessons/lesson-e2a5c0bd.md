## Lesson — 2026-03-08T00:56:41.780Z

**Tags:** style, curated
**Pattern:** expect\(._\.length\)\.(toBeGreaterThan|toBeLessThan)(OrEqual)?\(\d+\)
**Engine:** regex
**Scope:** _.test.ts, \*.spec.ts
**Severity:** warning

Use exact count assertions (e.g., toBe(10)) for fixed asset collections instead of weak bounds.
