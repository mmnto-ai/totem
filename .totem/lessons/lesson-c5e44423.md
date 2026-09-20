## Lesson — Maintain reporting symmetry across targets

**Tags:** cli, ux, design-pattern
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

When a command accounts for the same item on several roots (a distributed skill on `.claude/skills/` and `.agents/skills/`), its summary prints one row per root per item, absent or present, on every root alike — a `(not found)` row on one root and silence on another makes the accounting asymmetric and hides which root was checked. A reviewer's suggestion to filter one root's absent rows was declined on the measurement that the other root has always printed them (mmnto-ai/totem#2902).
