## Lesson — Environment variable keys like PATH are case-insensitive

**Tags:** windows, testing

Environment variable keys like `PATH` are case-insensitive on Windows, meaning test assertions must check for both 'Path' and 'PATH' to avoid platform-specific failures.
