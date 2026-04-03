## Lesson — Update manifests after artifact modification

**Tags:** build-system, ci, integrity
**Scope:** packages/cli/src/commands/shield.ts

Any process that modifies a tracked build artifact, such as capturing new observation rules, must trigger an in-place manifest rehash to prevent integrity check failures in CI.
