## Lesson — Core library modules should accept an optional onWarn

**Tags:** error-handling, architecture, observability

Core library modules should accept an optional `onWarn` callback instead of logging directly or silently swallowing errors. This pattern maintains a strict separation between core logic and presentation while ensuring that callers can observe and report internal failures like corrupt caches.
