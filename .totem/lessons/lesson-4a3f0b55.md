## Lesson — Use TotemError for CLI validation

**Tags:** cli, architecture
**Scope:** packages/cli/**/*.ts, !**/*.test.*

Use TotemError instead of TotemConfigError for CLI-layer validation to maintain proper architectural boundaries between the CLI and core packages.
