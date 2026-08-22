## Lesson — Reject line-scoped requirements on AST targets

**Tags:** ast, validation
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

AST nodes represent multi-line spans whose natural boundaries do not map cleanly to line-scoped requirements, making line-level checks highly formatting-dependent. Enforce a runtime fail-loud guard or lowering-time rejection when line-scoped requirements are configured for AST-based rules.
