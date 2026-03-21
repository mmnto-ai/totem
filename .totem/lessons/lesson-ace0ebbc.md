## Lesson — Core library modules should accept an optional onWarn

**Tags:** architecture, diagnostics, logging

Core library modules should accept an optional onWarn callback to surface diagnostics without hardcoding console dependencies. This allows callers to capture or report warnings from silent catch blocks that would otherwise be swallowed.
