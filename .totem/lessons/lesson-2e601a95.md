## Lesson — Always propagate parse warning callbacks in AST-based test

**Tags:** testing, diagnostics, ast-grep

Always propagate parse warning callbacks in AST-based test runners to ensure syntax errors in test fixtures do not silently cause false negatives. Swallowing these warnings makes it impossible to distinguish between a "no match" and a "failed to parse."
