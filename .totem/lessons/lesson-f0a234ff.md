## Lesson — Fail-closed on attribution conflicts

**Tags:** attribution, metrics, fail-closed
**Scope:** packages/core/src/**/*.ts, !**/*.test.*

When an environment seat disagrees with a session's minting seat, strip attribution from both candidates instead of guessing. This prevents corrupting metrics across multiple seats, while scoping the fail-closed behavior to the attribution metadata so the main operation still succeeds.
