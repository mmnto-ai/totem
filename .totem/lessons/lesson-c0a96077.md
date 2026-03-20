## Lesson — Identical regex patterns should remain as distinct rules

**Tags:** linting, architecture, patterns

Identical regex patterns should remain as distinct rules when they target different file scopes or require different severity levels. This approach provides granular control, such as enforcing a strict error in core modules while allowing a warning in test files for the same code pattern.
