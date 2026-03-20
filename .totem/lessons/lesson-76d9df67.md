## Lesson — 2026-03-06T06:25:26.036Z

**Tags:** performance, curated
**Pattern:** (\bimport\s+[^()]*\bfrom\s+['"]ora['"]|\brequire\s*\(\s*['"]ora['"]\s*\))
**Engine:** regex
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.ts
**Severity:** warning

Use dynamic imports for heavy dependencies like 'ora' within the specific functions that require them to avoid startup performance tax.
