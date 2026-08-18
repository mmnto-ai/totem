## Lesson — Validate seat identity before crown derivation

**Tags:** security, governance, skills
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

In distributed signoff workflows, step 0 must validate that TOTEM_SELF_AGENT matches the current session's own seat before evaluating the primary= marker. If the identity is foreign or invalid, the procedure must fail closed to prevent unauthorized crown decisions or shared upkeep mutations.
