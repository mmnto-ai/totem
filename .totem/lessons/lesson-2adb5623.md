## Lesson — BSD sed on macOS does not support the \x1b hex escape; use

**Tags:** shell, macos, portability

BSD sed on macOS does not support the \x1b hex escape; use perl or col -b to strip ANSI color codes in scripts that must run across different operating systems.
