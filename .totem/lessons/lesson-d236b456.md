## Lesson — Assert per-family coverage for compound rules

**Tags:** testing, security
**Scope:** packages/pack-agent-security/test/**/*.ts

Aggregate match counts in tests can hide regressions in specific sub-patterns; verify that every distinct logic family (e.g., `atob`, `Buffer`, `fromCharCode`) in a compound rule triggers at least one match.
