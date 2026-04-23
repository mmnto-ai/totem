## Lesson — Mirror local cleanup in cloud paths

**Tags:** cloud, consistency
**Scope:** packages/cli/src/commands/compile.ts

Ensure cloud compilation paths mirror local worker behavior by explicitly removing stale entries when a lesson is marked non-compilable to prevent old rules from remaining active.
