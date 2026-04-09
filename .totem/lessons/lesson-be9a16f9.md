## Lesson — Evict permanently failing federated links

**Tags:** mcp, search, resilience
**Scope:** packages/mcp/**/*.ts, !**/*.test.*

Repeatedly querying broken federated links introduces unnecessary latency and error noise. Attempting a targeted reconnect before evicting the failing link from the active pool balances resilience with performance.
