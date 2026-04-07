## Lesson — Avoid structural collisions in catch patterns

**Tags:** ast-grep, error-handling
**Scope:** .totem/compiled-rules.json

Patterns intended to detect missing error context in re-throws can collide with empty-catch rules if they are not sufficiently specific about the catch block's contents.
