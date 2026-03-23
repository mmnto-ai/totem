## Lesson — The github.event.pull_request context is immutable

**Tags:** github-actions, ci

The github.event.pull_request context is immutable for a specific workflow run, meaning manual re-runs will not reflect title or body edits made after the initial trigger.
