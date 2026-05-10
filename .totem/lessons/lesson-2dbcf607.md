## Lesson — Use .cjs extension for Claude hooks

**Tags:** claude, node, esm
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

In projects with 'type: module', use the .cjs extension for Claude Code hooks because Claude executes them via Node.js require(), which rejects .js files resolved as ESM.
