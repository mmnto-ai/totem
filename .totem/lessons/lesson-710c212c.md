## Lesson — Brace expansion (e.g., \*.{ts,js}) is not universally

**Tags:** glob, devtools, syntax

Brace expansion (e.g., `*.{ts,js}`) is not universally supported and can cause some glob engines to silently match zero files. To ensure reliability across different runners, expand these patterns into an explicit array of separate strings.
