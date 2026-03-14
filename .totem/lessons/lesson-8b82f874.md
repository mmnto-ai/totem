## Lesson — CLI command entrypoints should catch validation errors

**Tags:** cli, error-handling

CLI command entrypoints should catch validation errors and print clean, user-facing messages instead of throwing raw JavaScript errors. Reserve throwing for internal library functions to ensure the CLI remains professional and user-friendly.
