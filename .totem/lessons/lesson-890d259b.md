## Lesson — Avoid premature task-specific model overrides

**Tags:** orchestration, llm, config
**Scope:** packages/cli/src/commands/init-detect.ts

Do not automatically configure specialized model variants (e.g., large 26b models) during initialization if they aren't guaranteed to be present on the user's machine. Deferring complex routing to a dedicated orchestrator prevents friction caused by missing local dependencies.
