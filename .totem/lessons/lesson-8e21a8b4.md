## Lesson — Verify daemon status for local services

**Tags:** cli, ollama, dx
**Scope:** packages/cli/src/commands/init-detect.ts

Checking for a CLI on the PATH is insufficient for functional readiness of local LLM providers; verify the server is actually running via a heartbeat check before auto-configuring it as a dependency.
