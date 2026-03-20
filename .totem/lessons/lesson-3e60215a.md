## Lesson — 2026-03-06T05:41:19.122Z

**Tags:** style, curated
**Pattern:** (import\s+.*from\s+['"]inquirer['"]|require\(['"]inquirer['"]\)|\"inquirer\"\s*:)
**Engine:** regex
**Scope:** packages/cli/**/*.ts
**Severity:** warning

Do not use inquirer for prompts; use the built-in readline interface instead.
