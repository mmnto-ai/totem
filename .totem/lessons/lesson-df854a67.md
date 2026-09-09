## Lesson — Lock head SHA during pagination

**Tags:** github-api, graphql, concurrency
**Scope:** packages/core/src/merge-ready.ts

When paginating through API responses for a PR, verify the head SHA on every page against the initial read to prevent evaluating a moving target if a new commit is pushed mid-read.
