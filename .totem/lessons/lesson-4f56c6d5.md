## Lesson — Reversing the search order of Git refs (e.g., remote

**Tags:** git, architecture

Reversing the search order of Git refs (e.g., remote before local) can break existing error-handling contracts. A full audit of the error path across all re-exports is required before changing ref resolution logic to avoid stale merge-base issues.
