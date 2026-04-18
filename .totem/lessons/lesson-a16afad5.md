## Lesson — Prevent eval bypasses via concatenation

**Tags:** security, javascript, ast-grep
**Scope:** packages/pack-agent-security/test/**/*.ts, !**/*.test.*, !**/*.spec.*

Security rules for dynamic evaluation must ensure the argument is a single literal string to prevent bypasses using string concatenation or template interpolation.
