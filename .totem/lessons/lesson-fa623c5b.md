## Lesson — Consolidate dynamic imports in command handlers

**Tags:** dx, performance, cli
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*

Destructure all required helpers from a package at the start of the command handler instead of using multiple inline dynamic imports. This avoids redundant module resolution and sidesteps contradictory linting rules regarding lazy-loading in CLI environments.
