## Lesson — Surface specific git fallback errors

**Tags:** git, dx, error-handling
**Scope:** packages/cli/src/commands/extract.ts

Avoid using empty catch blocks when probing for git refs or remotes during fallbacks. Surfacing specific errors like 'missing upstream' helps users diagnose configuration issues rather than being met with a generic 'no changes found' message.
