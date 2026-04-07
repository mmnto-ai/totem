## Lesson — Prefer ast-grep for multi-line structural matches

**Tags:** ast-grep, tree-sitter, linting
**Scope:** .totem/compiled-rules.json

Tree-sitter `#eq?` predicates often only match literal single-line empty braces `{}`; use `ast-grep` for structural matching that correctly identifies multi-line empty blocks.
