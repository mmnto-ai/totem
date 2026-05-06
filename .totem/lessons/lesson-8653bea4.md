## Lesson — Write manifests before main execution logic

**Tags:** orchestration, cli
**Scope:** packages/cli/**/*.ts

Writing the state manifest before invoking the primary sync logic ensures the local resolution state is updated even when the secondary phase is short-circuited.
