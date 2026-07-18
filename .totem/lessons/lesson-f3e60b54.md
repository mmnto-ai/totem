## Lesson — Guard against trailing newline split artifacts

**Tags:** typescript, parsing, testing
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Splitting file content on newlines produces a phantom empty element for files ending with a trailing newline, causing off-by-one errors in line calculations. Test fixtures should explicitly include trailing newlines to prevent this edge case from going undetected.
