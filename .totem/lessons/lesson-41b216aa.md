## Lesson — Test runtime behavior over source-text locks

**Tags:** testing
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Asserting on the presence of source-code strings in a hook does not validate runtime execution; critical invariants (like file selection and tie-breaks) must be verified with behavioral unit tests using mock fixtures.
