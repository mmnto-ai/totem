## Lesson — When implementing automatic recovery that deletes

**Tags:** recovery, error-handling, database

When implementing automatic recovery that deletes a database, ensure a failed deletion (e.g., due to OS file locks) doesn't recursively trigger the same healing logic. Wrapping the post-healing reconnection attempt in a try/catch that throws a distinct, terminal error prevents the system from entering a loop if the environment prevents the reset.
