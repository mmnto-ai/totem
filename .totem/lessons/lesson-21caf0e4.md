## Lesson — When determining if a session is interactive, check both

**Tags:** cli, unix, ux

When determining if a session is interactive, check both stdin.isTTY and stdout.isTTY. This prevents the CLI from emitting ANSI escape codes or interactive prompts when output is being piped to another process or redirected to a file.
