## Lesson — Converting raw filesystem errors like ENOENT or EACCES

**Tags:** error-handling, nodejs, dx

Converting raw filesystem errors like ENOENT or EACCES into custom exceptions (e.g., TotemParseError) allows the application to provide actionable recovery hints to the user. This practice maintains a stable error contract and prevents low-level implementation details from leaking into the UI.
