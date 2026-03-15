## Lesson — Using a boolean flag to track lazy initialization causes

**Tags:** concurrency, typescript, lazy-loading

Using a boolean flag to track lazy initialization causes crashes when multiple concurrent calls, such as those from `Promise.all`, hit the getter before the first one completes. Storing and returning the same initialization promise ensures all callers await the same setup process and prevents null pointer exceptions.
