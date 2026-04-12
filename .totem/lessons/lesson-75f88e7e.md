## Lesson — Archive rules to preserve telemetry

**Tags:** architecture, telemetry, maintenance
**Scope:** .totem/compiled-rules.json

Archiving broken rules by setting `status: 'archived'` silences enforcement while preserving historical trigger and suppression data per ADR-074. This allows for future rule refinement without losing the context of past violations.
