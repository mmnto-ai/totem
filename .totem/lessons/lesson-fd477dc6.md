## Lesson — Run local floor probes unconditionally

**Tags:** cli, ux
**Scope:** packages/cli/src/commands/doctor.ts

Probing local fallbacks (like Ollama) regardless of the active provider ensures users know their 'floor' is ready before a cloud failure occurs.
