## Lesson — Sanitize colons to prevent NTFS corruption

**Tags:** fs, windows, ntfs
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Colons in filenames act as NTFS Alternate Data Stream separators on Windows, causing file writes to silently succeed into invisible streams that readdirSync cannot list. Stripping colons from basenames ensures cross-platform compatibility and prevents persistent unread states.
