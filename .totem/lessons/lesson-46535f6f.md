## Lesson — Use digitless placeholders for issue examples

**Tags:** changesets, github-actions, automation
**Scope:** .changeset/*.md

Even when wrapped in backticks, real issue reference shapes in changesets can propagate to release PR descriptions and trigger automated closure checks. Use digitless placeholders like `Closes #NNN` to prevent false-positive blocks without altering the illustrative meaning.
