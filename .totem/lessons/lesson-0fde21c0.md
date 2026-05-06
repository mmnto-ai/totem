## Lesson — Gracefully skip linting on empty rules

**Tags:** cli, lint, ci
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*

Returning an empty result instead of throwing when rules are missing allows CI to exit cleanly for repositories in early adoption stages.
