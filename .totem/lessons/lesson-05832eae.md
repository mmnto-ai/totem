## Lesson — Define generic visiting agent detection rules

**Tags:** agent-orchestration, architecture, multi-vendor
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*

Keying visiting-agent logic on hardcoded vendor-specific cell values or placeholder formats fails when vendor columns vary or are omitted. Using a generic rule that checks if the active agent's ID is absent from its row ensures compatibility across all vendor schemas.
