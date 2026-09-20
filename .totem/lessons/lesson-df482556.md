## Lesson — Verify marker order during cleanup

**Tags:** safeguard, parser, cli
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Checking only marker presence when validating file ownership can lead to unintended deletion of user-modified files if markers are malformed or reversed. Always check the relative index positions of start and end markers to verify actual vendor control.
