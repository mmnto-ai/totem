## Lesson — Extract logic that wraps unknown errors

**Tags:** architecture, error-handling, dx

Extract logic that wraps unknown errors into domain-specific exceptions with recovery hints into a centralized helper. This ensures consistent error reporting across different implementations and prevents the double-wrapping of custom error types.
