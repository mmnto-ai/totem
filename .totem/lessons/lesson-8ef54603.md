## Lesson — Dispatch logic via single kind resolution

**Tags:** architecture, pattern, refactoring
**Scope:** packages/cli/src/commands/spine-cert-materialize.ts

Using a single resolution point at the entry of a materializer (e.g., seed.producerKind) ensures clean branching. This prevents logic leakage between different producer types and keeps legacy paths byte-unchanged.
