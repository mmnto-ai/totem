## Lesson — Keep error details in message

**Tags:** cli, errors, architecture
**Scope:** packages/cli/src/adapters/**/*.ts, !**/*.test.*, !**/*.spec.*

When throwing errors in CLI adapters, place remediation details directly in the error message rather than relying solely on recovery hints, as downstream error envelopes may only surface the message. Additionally, reuse existing broad error codes rather than over-reaching and adding single-use members to core schema error code unions.
