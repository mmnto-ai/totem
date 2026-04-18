## Lesson — Match both quote styles in AST string arguments

**Tags:** ast-grep, security
**Scope:** packages/pack-agent-security/test/**/*.ts

When matching specific string literals in AST rules (e.g., `Buffer.from(..., 'hex')`), explicitly include both single and double quote variants to ensure the rule is robust against trivial formatting changes.
