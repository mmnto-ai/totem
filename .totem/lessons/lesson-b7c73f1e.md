## Lesson — CLI command entrypoints should catch validation errors

**Tags:** style, curated
**Pattern:** \bthrow\s+new\s+(?!Totem)\w*Error\(
**Engine:** regex
**Scope:** packages/cli/\*\*/*.ts, !**/\*.test.ts
**Severity:\*\*\*\* warning

CLI entrypoints should catch errors and print clean messages instead of throwing raw JavaScript errors. TotemError and its subclasses are exempt — they are caught by the CLI error handler.
