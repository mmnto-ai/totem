## Lesson — Distinguish empty from skipped-only states

**Tags:** dx, logic, cli
**Scope:** packages/cli/src/commands/test-rules.ts

Check both total and skipped counts before triggering 'no data' guidance or early returns. This ensures that directories containing only TODO placeholders still emit warnings to the developer instead of being incorrectly reported as empty.
