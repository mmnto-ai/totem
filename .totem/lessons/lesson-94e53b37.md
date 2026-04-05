## Lesson — Distinguish CLI existence from service availability

**Tags:** cli, ollama, dx
**Scope:** packages/cli/src/commands/init-detect.ts

Checking for a binary on the PATH confirms installation but not that the local service is active. For a true zero-config experience, use lightweight API pings (like a HEAD request) to verify the service is reachable before configuring it as a default.
