## Lesson — Use .cjs for Claude Code hooks

**Tags:** claude, node, esm
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

In projects using `type: module`, Claude Code hooks must use the `.cjs` extension because they are executed via Node.js `require()`, which rejects ESM `.js` files.
