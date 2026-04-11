## Lesson — Refresh manifests on pure input hash drift

**Tags:** architecture, integrity
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Ensure manifests are updated when input hashes change even if output is identical, preventing verification failures in downstream hooks.
