## Lesson — 2026-03-07T06:05:56.069Z

**Tags:** security, curated
**Pattern:** \.startsWith\s*\(\s*['"]\(
**Engine:** regex
**Scope:** scripts/**/*.js, scripts/**/*.ts, scripts/**/*.mjs, scripts/**/*.cjs, tools/**/*.js, tools/**/*.ts, tools/**/*.mjs, tools/**/*.cjs, .husky/**/*, **/hooks/**/*
**Severity:** error

Avoid generic line-matching patterns like startsWith('(') when scrubbing auto-generated sections. Use precise line matches or unique block markers to prevent accidental removal of user-added logic.
