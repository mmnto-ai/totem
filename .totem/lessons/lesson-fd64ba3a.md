## Lesson — Core library code should avoid direct calls to console

**Tags:** architecture, logging, typescript

Core library code should avoid direct calls to `console` to prevent unexpected side effects in consuming applications. Defaulting to a no-op function for warning callbacks allows the consumer to maintain full control over where logs are routed.
