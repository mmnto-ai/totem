## Lesson — Prevent manifest desyncs in CLI hints

**Tags:** cli, git, manifest
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

CLI error hints should not instruct users to revert individual compiled artifacts via Git, as this causes state desynchronization. Instead, guide users through the proper archive-in-place or regeneration workflow.
