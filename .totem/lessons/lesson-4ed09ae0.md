## Lesson — Writing to a temporary file and then renaming it prevents

**Tags:** io, resilience

Writing to a temporary file and then renaming it prevents partial or corrupted reads. This pattern is essential for checkpoint files that might be accessed concurrently or during a crash.
