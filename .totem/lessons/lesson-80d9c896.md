## Lesson — Anchor ownership markers to file starts

**Tags:** cli, security, file-io
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Ownership verification checks must require the marker to be at the file's opening position rather than simply existing in the content. This prevents accidental overwrites of user-owned files that contain quoted or nested references to the marker.
