## Lesson — Enforce provider-specific cache TTL constraints

**Tags:** anthropic, validation
**Scope:** packages/core/src/config-schema.ts

Anthropic prompt caching only supports specific TTL values (300s or 3600s); enforcing these in the schema prevents runtime API failures.
