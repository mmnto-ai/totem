## Lesson — Validate search results against fresh API state

**Tags:** github-api, ci, monitoring
**Scope:** .github/workflows/**/*.yml

GitHub's search index is eventually consistent and can return stale issue states. Always re-verify issue titles and open states directly on the retrieved JSON objects to prevent duplicate alerts.
