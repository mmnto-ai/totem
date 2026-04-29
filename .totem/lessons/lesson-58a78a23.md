## Lesson — Map minor bot findings to nit severity

**Tags:** dx, bot-review, schema
**Scope:** packages/cli/**/*.ts, !**/*.test.*

When mapping external bot findings to internal schemas, categorize non-critical or minor severities as 'nit' rather than 'low' to maintain semantic clarity for cosmetic or non-blocking issues.
