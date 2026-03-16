## Lesson — CLI command files should use dynamic await import()

**Tags:** performance, cli, typescript

CLI command files should use dynamic `await import()` for heavy internal packages within the command function rather than top-level static imports. This ensures that simple operations like `--help` or version checks remain fast by avoiding unnecessary module loading at startup.
