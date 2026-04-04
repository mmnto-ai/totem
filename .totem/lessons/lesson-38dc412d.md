## Lesson — Distinguish dropped selectors from skipped rules

**Tags:** architecture, eslint
**Scope:** packages/core/src/eslint-adapter.ts

In ESLint adapters, individual unsupported selectors within a rule should be silently dropped while the rule remains active for other selectors. The 'skipped' status should only be applied if the entire rule is non-functional to ensure accurate coverage reporting.
