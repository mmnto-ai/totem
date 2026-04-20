## Lesson — Sync hook templates with registry

**Tags:** cli, maintenance
**Scope:** packages/cli/src/commands/init-templates.ts

Removing a command from the registry without updating hook templates causes 'unknown command' errors in new sessions. Always verify `init-templates.ts` when deprecating CLI features.
