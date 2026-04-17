## Lesson — Use unit separators for Git parsing

**Tags:** git, parsing
**Scope:** packages/mcp/src/**/*.ts, !**/*.test.*

Avoid using common characters like pipes as delimiters in Git log output, as they can collide with commit titles. Use non-printable unit separators to ensure robust parsing of user-generated content.
