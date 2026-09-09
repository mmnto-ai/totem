## Lesson — Prefer execution allowlists over denylists

**Tags:** testing, mocking, security
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

When mocking or spying on shell executions to prevent mutations during dry runs, use an allowlist of exact permitted shapes. Denylists are fragile and can let unexpected mutating command variants escape assertion.
