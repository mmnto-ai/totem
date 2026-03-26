---
tags: ["architecture", "ast-grep", "tooling"]
lifecycle: nursery
---

## Lesson — When generating ast-grep patterns, the pattern must be

**Tags:** architecture, ast-grep, tooling

When generating ast-grep patterns, the pattern must be emitted as a plain code string rather than wrapped in backticks or template literal syntax. ast-grep parses patterns into AST nodes via tree-sitter; wrapping them in backticks causes the engine to match a template literal string node instead of the intended structural code expression.
