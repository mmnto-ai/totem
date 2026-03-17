## Lesson — Moving instructions from the error message string

**Tags:** error-handling, ux, cli

Moving instructions from the error message string to a dedicated `recoveryHint` property enables consistent CLI formatting for user fixes. This separation allows the error renderer to automatically label solutions with a "Fix:" prefix while keeping the primary error message focused strictly on the failure.
