## Lesson — Key check collapsing on unique producer

**Tags:** github, ci, status-checks
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Status check deduplication must group by both the name and its producer (app slug and workflow ID) rather than name alone. This prevents a successful run from one workflow from incorrectly hiding a failure in a same-named check from another workflow.
