## Lesson — When testing expected failures, assert the specific error

**Tags:** testing, best-practices

When testing expected failures, assert the specific error message or violation count instead of just checking if an error was thrown. This prevents false positives where a different, unrelated error satisfies the test.
