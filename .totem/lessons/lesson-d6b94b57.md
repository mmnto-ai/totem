## Lesson — Case-insensitive matching for Windows executables

**Tags:** win32, security, parsing
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Windows executable checks must match the basename (like `gh.exe`) case-insensitively to prevent casing-based gate bypasses on Win32, while POSIX command matching remains exact.
