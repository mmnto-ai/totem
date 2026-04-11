## Lesson — Separate enforcement and administrative loaders

**Tags:** architecture, data-access
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Distinguish between runtime enforcement loaders that filter by lifecycle state and administrative loaders that provide the full manifest for telemetry and management.
