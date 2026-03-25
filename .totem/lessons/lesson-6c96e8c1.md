## Lesson — Passing large data payloads via stdin instead

**Tags:** cli, windows

Passing large data payloads via stdin instead of command-line arguments avoids reaching `ARG_MAX` limits, which are significantly more restrictive on Windows.
