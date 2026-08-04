## Lesson — Order shell redirections left to right

**Tags:** shell, posix, logging
**Scope:** tools/post-merge, packages/cli/src/commands/install-hooks.ts

Shell redirections are evaluated from left to right, meaning a stderr redirect like `2>/dev/null` must precede an append redirection to properly suppress errors if the log file is unwritable.
