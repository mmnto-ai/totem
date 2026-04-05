## Lesson — Avoid hardcoding unpulled model variants

**Tags:** llm, orchestration, dx
**Scope:** packages/cli/src/commands/init-detect.ts

Do not default to specialized model variants (e.g., high-parameter models for specific tasks) during initialization unless they are guaranteed to be present, as this breaks the zero-config experience.
