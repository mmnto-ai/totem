## Lesson — Prefer engine execution for citations

**Tags:** architecture, dx
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Run the full rule engine instead of simple glob matching when predicting findings to ensure accurate file:line citations and severity levels.
