## Lesson — Prefer in-process CLI command execution

**Tags:** cli, dx, architecture
**Scope:** packages/cli/src/commands/doctor.ts

When one CLI command needs to trigger another (e.g., doctor triggering compile), call the command function directly in-process rather than spawning a shell. This avoids hardcoding specific package managers and ensures the execution works across global installs and different environments.
