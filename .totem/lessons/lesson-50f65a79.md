## Lesson — Rule sets should be filtered by their specific execution

**Tags:** architecture, performance

Rule sets should be filtered by their specific execution engine before being passed to executors to prevent processing errors. This ensures that rules are only dispatched to compatible runners and optimizes the overall execution pipeline.
