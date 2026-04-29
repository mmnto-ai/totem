## Lesson — Implement per-item catch in batch pipelines

**Tags:** resilience, github-api
**Scope:** packages/cli/src/commands/recurrence-stats.ts

Use per-PR catch blocks in history-scanning pipelines to ensure transient errors or rate limits on a single item do not abort the entire multi-PR analysis.
