## Lesson — Prefer parsed config over regex parsing

**Tags:** cli, config, validation
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*

When validating configuration settings in CLI commands, use the already-parsed config object rather than regexing raw source text to correctly handle YAML block lists and computed values.
