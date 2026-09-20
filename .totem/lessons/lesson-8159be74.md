## Lesson — Verify bot reviews using head SHA

**Tags:** ci, github-actions, code-review
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Review bots like CodeRabbit often post green commit statuses even when a review was skipped for that specific head. To prevent triaging stale reviews, verify the review against the head SHA or matching SHA inside the summary comments instead of trusting status checks.
