## Lesson — CLI command modules should use dynamic imports for core

**Tags:** architecture, cli, performance

CLI command modules should use dynamic imports for core library values to prevent unnecessary overhead at startup. This ensures heavy packages are only loaded when a specific command handler is actually executed.
