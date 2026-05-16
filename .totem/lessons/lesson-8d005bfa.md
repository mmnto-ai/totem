## Lesson — Prefer flat schemas for initial telemetry lifts

**Tags:** zod, architecture, telemetry
**Scope:** packages/core/src/ledger.ts

Using a flat schema instead of a discriminated union simplifies initial telemetry extensions, provided that consumer-side guards handle the resulting optional fields.
