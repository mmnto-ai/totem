## Lesson — Segregate pacing for batch and query embeds

**Tags:** embeddings, rate-limiting, performance
**Scope:** packages/core/src/embedders/**/*.ts, !**/*.test.*

Pacing should only apply to multi-text batch ingestions to avoid rate limits, while single-text query embeds (such as search or MCP tools) must bypass pacing to maintain low latency.
