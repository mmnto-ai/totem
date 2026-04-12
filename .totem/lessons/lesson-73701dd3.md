## Lesson — Split enforcement and administrative loaders

**Tags:** architecture, dx, data-lifecycle
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Separating runtime enforcement loaders from administrative file loaders allows silencing items in production while preserving their lifecycle history for telemetry and management tools.
