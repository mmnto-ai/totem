## Lesson — Always use dynamic imports for heavy logic or detection

**Tags:** cli, performance, nodejs
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.ts, !**/*.spec.ts

Always use dynamic imports for heavy logic or detection modules within CLI command functions. This ensures fast CLI startup performance by preventing the eager loading of code not required for the specific subcommand being executed.
