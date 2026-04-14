## Lesson — Thread explicit cwd through command chains

**Tags:** cli, dx
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Ensure `cwd` parameters are passed through to all internal command invocations to prevent silent divergence where sub-commands default to `process.cwd()`.
