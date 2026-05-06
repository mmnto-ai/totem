## Lesson — Split CLI commands for keyless CI

**Tags:** cli, ci, architecture
**Scope:** packages/cli/**/*.ts

Decomposing commands into deterministic resolution (Phase A) and side-effectful sync (Phase B) allows CI environments to validate manifests without requiring sensitive API keys.
