## Lesson — Enforce exact package publish surface

**Tags:** testing, npm, security
**Scope:** packages/pack-agent-security/test/structure.test.ts

Using 'expect.arrayContaining' for package.json files allows accidental artifacts to be published; use exact equality or length checks to strictly lock the shippable surface.
