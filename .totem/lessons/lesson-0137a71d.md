## Lesson — Guard Git ranges against flag injection

**Tags:** git, security, cli
**Scope:** packages/core/src/sys/git.ts

User-provided Git ref ranges must be checked for leading dashes to prevent them from being interpreted as command flags (e.g., --no-index) during execution.
