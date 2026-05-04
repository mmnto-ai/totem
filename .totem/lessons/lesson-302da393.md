## Lesson — Prefer dynamic resolution over git submodules

**Tags:** git, architecture, dx
**Scope:** packages/mcp/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Replacing git submodules with a multi-layer resolver (env, config, sibling) eliminates gitlink pointer drift and mandatory fetch overhead for all checkouts.
