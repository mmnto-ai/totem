## Lesson — Static top-level imports from heavy internal packages delay

**Tags:** performance, cli, typescript

Static top-level imports from heavy internal packages delay startup for every CLI invocation, including simple flags like --help. Moving these to dynamic await imports inside the command function ensures dependencies are only loaded when the specific command is executed.
