## Lesson — Use .min(1) on string schemas within configuration arrays

**Tags:** zod, validation, configuration

Use `.min(1)` on string schemas within configuration arrays to reject empty strings at the parsing stage. Catching invalid configuration values early provides clearer feedback to users compared to silently filtering them out during runtime execution.
