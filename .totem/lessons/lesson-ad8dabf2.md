## Lesson — CLI entrypoints print clean errors, libraries throw

**Tags:** style, curated
**Pattern:** \bthrow\s+
**Engine:** regex
**Scope:** packages/cli/src/index.ts, packages/cli/src/bin/**/*.ts, packages/cli/src/cli.ts, **/cli.ts
**Severity:** warning

CLI entrypoints should print clean errors and exit gracefully instead of throwing; reserve throwing for internal library functions.
