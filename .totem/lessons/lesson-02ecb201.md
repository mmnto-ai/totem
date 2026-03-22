## Lesson — File deletions and mutations in cleanup or "eject" commands

**Tags:** cli, error-handling, filesystem

File deletions and mutations in cleanup or "eject" commands should be wrapped in try/catch blocks so a single permission error doesn't abort the entire routine. Failures should be recorded as skipped items in a summary report rather than throwing fatal exceptions.
