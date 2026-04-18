## Lesson — Prefer field scoping in ast-grep

**Tags:** ast-grep, security
**Scope:** packages/pack-agent-security/compiled-rules.json

Using descendant `has` checks for call arguments allows bypasses via mixed expressions like string concatenation. Use `field` scoping (e.g., `arguments.0`) to target the node directly for strict literal validation.
