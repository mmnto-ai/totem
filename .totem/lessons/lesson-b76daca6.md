## Lesson — When execution utilities wrap errors, handlers must check

**Tags:** error-handling, node.js

When execution utilities wrap errors, handlers must check both the wrapper and the underlying cause to reliably match specific error patterns like rate limits or missing binaries.
