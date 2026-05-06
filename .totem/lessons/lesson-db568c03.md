## Lesson — Validate mutually exclusive phase flags

**Tags:** cli, ux, validation
**Scope:** packages/cli/**/*.ts

Hard-erroring when flags configure a skipped phase prevents silent no-ops and ensures users understand the boundaries between independent execution phases.
