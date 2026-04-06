## Lesson — Sync summary counts with active filters

**Tags:** cli, ux, filtering
**Scope:** packages/cli/src/commands/test-rules.ts

Summary counts (passed, failed, skipped) must reflect the filtered subset rather than global totals. This maintains consistency between the displayed logs and the final status line when a user limits the command scope.
