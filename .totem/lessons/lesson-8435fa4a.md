## Lesson — Write registry records before executing commands

**Tags:** architecture, state-management, git
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Creating a registry record before running external setup commands (like git worktree creation) prevents unrecorded resources if the command fails or is interrupted — a phantom record fails visible in a listing, while a created-but-unrecorded resource fails invisible.
