## Lesson — Use field scoping for argument validation

**Tags:** ast-grep, security, linting
**Scope:** packages/pack-agent-security/test/**/*.ts

Using 'has' in ast-grep rules can allow bypasses via mixed expressions; use 'field' scoping (e.g., 'arguments.0') to strictly enforce that arguments are pure literals.
