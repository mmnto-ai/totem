## Lesson — Implement verification shadow for rule promotion

**Tags:** architecture, api-design
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Use a `verification_shadow` field to allow new rules to execute and emit signals without affecting the final decision, facilitating a safe promotion path for new logic.
