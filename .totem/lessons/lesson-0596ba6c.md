## Lesson — Use pathToFileURL for dynamic ESM imports

**Tags:** esm, node, windows
**Scope:** .claude/hooks/**/*.js, !**/*.test.*, !**/*.spec.*

Wrap absolute paths in `pathToFileURL` when using dynamic imports in Node.js. This ensures compatibility with Windows file systems and prevents resolution errors for workspace-relative modules.
