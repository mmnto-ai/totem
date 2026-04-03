## Lesson — Global config paths must be absolute

**Tags:** cli, config, node
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*

The `totemDir` in a global configuration must be an absolute path to ensure rules are correctly resolved regardless of the current working directory. Relative paths in global profiles resolve relative to the project root where the command is executed, causing lookup failures.
