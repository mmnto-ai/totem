## Lesson — Core library modules should accept an optional onWarn

**Tags:** architecture, logging, typescript

Core library modules should accept an optional `onWarn` callback instead of using `console` methods or logging directly. This prevents hard dependencies on logging frameworks and ensures diagnostics are surfaced to callers rather than being swallowed in silent catch blocks.
