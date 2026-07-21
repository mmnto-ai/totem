## Lesson — Treat all close-keyword references as active

**Tags:** github, git, regex
**Scope:** packages/core/src/autoclose/**/*.ts, !**/*.test.*, !**/*.spec.*

GitHub's auto-close parser matches issue references adjacent to close keywords regardless of negation, quotes, or emphasis. Matchers must treat all such occurrences as active anomalies rather than attempting to parse negation.
