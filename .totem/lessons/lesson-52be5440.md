## Lesson — Unify target roots across lifecycles

**Tags:** architecture, dry, cli
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Symmetric CLI operations like initialization and ejection must share a single source of truth for their target directory paths. Deriving both rosters from a unified constant prevents silent configuration drift between the creation and removal phases.
