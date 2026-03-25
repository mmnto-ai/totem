## Lesson — In CLI modules with mixed exports, only dependencies

**Tags:** performance, architecture

In CLI modules with mixed exports, only dependencies required by synchronous functions should remain as static imports. Utilities used exclusively by async handlers should be dynamically imported or injected to prevent bloating the eager dependency graph during startup.
