## Lesson — Reusing regex objects with the global flag in loops leads

**Tags:** typescript, regex, parsing

Reusing regex objects with the global flag in loops leads to bugs because the `lastIndex` property persists between calls. Always instantiate fresh regex instances or manually reset the index to zero before execution to ensure consistent matching.
