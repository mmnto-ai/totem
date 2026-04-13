## Lesson — Provide explicit recovery hints for missing directories

**Tags:** cli, errors
**Scope:** packages/cli/src/commands/compile.ts

Throw specific errors like `NO_LESSONS_DIR` with actionable recovery hints instead of generic parse errors when required resources are missing. This improves developer experience by guiding the user toward the correct initialization or extraction command.
