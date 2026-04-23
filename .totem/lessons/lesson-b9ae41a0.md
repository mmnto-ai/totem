## Lesson — Stage specific files in CLI tools

**Tags:** git, cli, dx
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Passing explicit file paths to git add instead of using broad patterns prevents CLI tools from accidentally staging unrelated changes in the user's working tree.
