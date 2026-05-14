## Lesson — Decouple CLI logic from process exit

**Tags:** cli, architecture
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*

Command implementation functions should return result objects instead of calling `process.exit` or setting `process.exitCode`. This prevents side effects when commands are invoked programmatically by other internal tools.
