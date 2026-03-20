## Lesson — 2026-03-06T01:32:23.369Z

**Tags:** security, curated
**Pattern:** \bstripAnsi\s*\(|\.replace\(\s*\/\\(x1[bB]|u001[bB])
**Engine:** regex
**Scope:** packages/mcp/**/*.ts, !**/*.test.ts
**Severity:** error

Use a tested ANSI-stripping library instead of hand-rolled regex replacements.
