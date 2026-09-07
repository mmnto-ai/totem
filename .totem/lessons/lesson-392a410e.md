## Lesson — Use CJS extension for hook scripts

**Tags:** claude-code, node, esm
**Scope:** .claude/hooks/**/*

Claude Code executes hook scripts using plain `node`, which will fail if the repository uses ESM (`"type": "module"`) and the hook uses CommonJS. Using the `.cjs` extension ensures the script is always executed correctly regardless of the package type.
