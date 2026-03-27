## Lesson — When using dependency injection that mutates module-global

**Tags:** testing, logging, architecture

When using dependency injection that mutates module-global state, wrap the execution in a try-finally block to restore the original state and prevent callback leakage across tests.
