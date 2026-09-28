## Lesson — Prioritize target validation over auth diagnostics

**Tags:** cli, error-handling
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Override generic authentication error hints with target-existence checks when a fetch fails. This ensures users are not misled into debugging credentials when the target repository itself is incorrect or missing.
