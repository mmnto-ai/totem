## Lesson — Guard git refs against flag injection

**Tags:** git, security, cli
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*

User-provided git references in CLI flags must be guarded against flag injection. This prevents positional arguments from being interpreted as additional git options during command execution.
