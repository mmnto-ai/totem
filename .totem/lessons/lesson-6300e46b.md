## Lesson — Gate rules only against supported engines

**Tags:** compiler, validation
**Scope:** packages/core/src/compile-smoke-gate.ts

Explicitly skip compile-time smoke gates for rule engines (like Tree-sitter 'ast') that the gate mechanism does not yet support to prevent valid rules from being hard-rejected.
