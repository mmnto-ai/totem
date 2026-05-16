## Lesson — Prefer configuration over hardcoded tool patterns

**Tags:** architecture, dx
**Scope:** packages/core/**/*.ts, !**/*.test.*

Avoid hardcoding specific tool names or paths in core logic to maintain the 'Platform of Primitives' tenet, allowing repository-specific overrides via configuration.
