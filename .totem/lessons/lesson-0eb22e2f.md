## Lesson — Downgrade missing credentials to warnings

**Tags:** dx, ci, doctor
**Scope:** packages/cli/src/commands/doctor.ts

Missing API keys or environment-specific configuration should trigger `warn` rather than `fail` in diagnostics. This avoids blocking CI or git hooks in environments where those specific integrations are not required.
