## Lesson — Functions that mutate module-global state for dependency

**Tags:** architecture, testing, state-management

Functions that mutate module-global state for dependency injection must use try-finally blocks to restore defaults, preventing state leakage across test cases or process executions.
