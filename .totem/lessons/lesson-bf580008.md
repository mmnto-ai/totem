## Lesson — Issue numbers are only unique within a single repository;

**Tags:** architecture, curated
**Pattern:** (^|[^a-zA-Z0-9-_./])#\d+
**Engine:** regex
**Scope:** packages/cli/**/*.ts, apps/cli/**/*.ts, !**/*.test.ts
**Severity:** error

Use qualified issue syntax (owner/repo#number) to prevent collisions across repositories in CLI commands.
