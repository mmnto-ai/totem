## Lesson — Support parameterless catch in AST patterns

**Tags:** javascript, typescript, ast-grep
**Scope:** .totem/compiled-rules.json

The `catch ($ERR)` pattern misses ES2019+ parameterless catch blocks; ensure patterns account for both forms to avoid false negatives in error-handling rules.
