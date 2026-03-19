## Lesson — When implementing custom error handlers that suppress stack

**Tags:** cli, debugging, errors

When implementing custom error handlers that suppress stack traces for cleaner output, always include a debug environment variable to restore full traces for developers. This ensures that the improved end-user UX does not hinder troubleshooting of legitimate internal failures.
