## Lesson — The use of dynamic imports inside CLI command handlers

**Tags:** cli, performance, nodejs

The use of dynamic imports inside CLI command handlers ensures that heavy dependencies and core logic are only loaded when that specific command is executed. This architectural pattern prevents unnecessary overhead and maintains a fast initial boot time for the tool across all other commands.
