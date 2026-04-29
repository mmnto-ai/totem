## Lesson — Derive staged status from resolved diffs

**Tags:** cli, git, telemetry
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Set metadata flags like isStaged based on the resolved diff source rather than raw CLI flags to ensure accurate downstream telemetry.
