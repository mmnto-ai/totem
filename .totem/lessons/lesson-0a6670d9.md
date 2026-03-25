## Lesson — Top-level error handlers should use raw console.error

**Tags:** cli, logging, architecture

Top-level error handlers should use raw console.error instead of high-level utilities to ensure visibility even if module loading or initialization fails.
