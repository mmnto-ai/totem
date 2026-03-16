## Lesson — Avoid using console methods directly in core library

**Tags:** architecture, logging, core-library

Avoid using `console` methods directly in core library modules to maintain I/O separation and portability. Provide an optional `onWarn` callback so consuming applications (like the CLI) can decide how to surface warnings within their specific UI.
