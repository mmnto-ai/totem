## Lesson — Query engines must throw exceptions on parsing or query

**Tags:** security, ast, error-handling

Query engines must throw exceptions on parsing or query crashes instead of returning empty result sets. Returning empty arrays creates a fail-open security vulnerability where malformed or malicious code can bypass detection gates silently.
