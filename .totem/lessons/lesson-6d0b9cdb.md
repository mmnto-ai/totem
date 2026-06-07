## Lesson — Calculate scope warnings using post-filter diffs

**Tags:** git, ux, lint
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*

Narrow-scope warnings should be calculated using post-ignore-filter diffs to ensure exact parity with the pre-push gate. This prevents overcounting ignored files and ensures the warning accurately reflects the gap in coverage.
