## Lesson — Regex-based import restrictions often incorrectly flag

**Tags:** linting, ast-grep, typescript

Regex-based import restrictions often incorrectly flag type-only imports and miss dynamic imports. Using an AST-aware engine ensures rules correctly distinguish between value and type usage across all module loading syntaxes.
