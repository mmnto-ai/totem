## Lesson — Avoid general assertion helpers in CLI options

**Tags:** cli, validation, errors
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Using general validation helpers like `assertSafeAgentId` in the CLI layer can throw misleading error codes (e.g., `MAIL_SEND_FAILED` for a polling command). Use direct `TotemError` validation to ensure accurate error codes and diagnostics for specific CLI options.
