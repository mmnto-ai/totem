## Lesson — Prevent boundary routing fallbacks on error

**Tags:** mcp, routing, security
**Scope:** packages/mcp/**/*.ts, !**/*.test.*

Falling back to a global search when a specific boundary link is broken can return misleading results from the primary repository. Explicitly checking for initialization errors before the fallback prevents silent drift in agent context.
