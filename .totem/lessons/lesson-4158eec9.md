## Lesson — Implementing per-query error handling in batch AST matching

**Tags:** ast, error-handling, typescript

Implementing per-query error handling in batch AST matching prevents language-specific node name errors from crashing the entire linting process. This allows the engine to gracefully degrade and continue processing other queries even if one query is incompatible with the current file type.
