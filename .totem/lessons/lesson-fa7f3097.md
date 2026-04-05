## Lesson — Leverage ast-grep for property matching

**Tags:** ast-grep, eslint
**Scope:** packages/core/src/eslint-adapter.ts

The ast-grep engine natively matches dot access, optional chaining, and bracket notation without complex regex gymnastics. Use it for simple identifier pairs to improve rule robustness and simplify pattern logic.
