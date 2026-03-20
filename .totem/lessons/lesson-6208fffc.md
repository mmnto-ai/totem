## Lesson — Dynamic imports should be limited to CLI command entry

**Tags:** style, curated
**Pattern:** \bimport\s*\(
**Engine:** regex
**Scope:** packages/core/src/\*\*/*.ts, packages/cli/src/adapters/**/\*.ts, packages/cli/src/utils.ts, !**/\*.test.ts
**Severity:** warning

Dynamic imports should be limited to CLI command entry points to avoid security scanner flags and maintain clean dependency graphs.
