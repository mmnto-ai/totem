## Lesson — Provide ungated recovery paths for fail-closed gates

**Tags:** security, ux, cli
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

When a security gate fails closed due to a missing CLI, the error message must explicitly guide the user to ungated recovery paths (like an external terminal) to avoid trapping them in a blocked state.
