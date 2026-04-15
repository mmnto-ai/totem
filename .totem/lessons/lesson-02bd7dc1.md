## Lesson — Exempt AST engines from smoke gate requirements

**Tags:** architecture, validation
**Scope:** packages/core/src/compiler-schema.ts

The 'ast' engine is exempt from 'badExample' requirements because the current smoke gate infrastructure only supports regex and ast-grep verification.
