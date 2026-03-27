## Lesson — When using ES2022 error causes, concatenating the original

**Tags:** errors, typescript, logging

When using ES2022 error causes, concatenating the original error message into the new wrapper message creates redundant log output. Rely on the error handler to traverse the cause chain and extract failure details.
