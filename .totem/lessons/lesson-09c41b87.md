## Lesson — Probe local fallbacks regardless of configuration

**Tags:** ux, diagnostics
**Scope:** packages/cli/src/commands/doctor.ts

Run health checks for local 'floor' providers even when cloud providers are active. Surfacing fallback availability during diagnostics prevents users from reaching for complex workarounds when primary providers fail.
