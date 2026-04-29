## Lesson — Avoid stamping cache on forecasts

**Tags:** cli, caching, security
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Do not update the reviewed-content-hash cache during estimation or empty-diff runs, as forecasts are not equivalent to verified reviews and could allow push-gate bypasses.
