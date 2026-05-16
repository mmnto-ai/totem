## Lesson — Defensively guard consumers after schema relaxation

**Tags:** zod, validation, cli
**Scope:** packages/cli/src/commands/**/*.ts

When fields are relaxed to optional at the schema level to support new event types, existing consumers must implement explicit guards to skip events missing previously required data.
