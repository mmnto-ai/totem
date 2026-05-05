## Lesson — Validate mutex flags before side-effecting calls

**Tags:** cli, architecture
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*

Validating mutually exclusive flags before loading configuration prevents confusing diagnostic errors, such as missing API keys, when the command would have failed regardless.
