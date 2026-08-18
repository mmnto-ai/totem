## Lesson — Secure default behavior over configuration

**Tags:** security, architecture, cli
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

When a repository resolves to multiple identities, the default CLI behavior must be secure and restricted rather than relying on correct user configuration. Serving a union view by default exposes sensitive metadata across seats.
