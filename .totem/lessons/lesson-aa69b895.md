## Lesson — Avoid unverified workflow concurrency syntax

**Tags:** github-actions, ci, concurrency
**Scope:** .github/workflows/**/*.yml

Using unverified GitHub Actions concurrency properties like `queue: max` can invalidate the entire workflow syntax and prevent it from loading. Stick to classic concurrency groups to ensure critical workflows do not silently go dark.
