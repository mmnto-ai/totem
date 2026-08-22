## Lesson — Guard file readers against path traversal

**Tags:** security, fs
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

When resolving repository file paths dynamically, validate that the resolved path remains within the project root using `path.relative`. Treat escaping paths (absolute or starting with `..`) as unreadable to prevent directory traversal vulnerabilities.
