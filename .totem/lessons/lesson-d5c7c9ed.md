## Lesson — Switching embedding providers without rebuilding the index

**Tags:** lancedb, embeddings, mcp

Switching embedding providers without rebuilding the index often results in cryptic Rust panics in vector databases like LanceDB. Implementing a health check that compares expected versus stored dimensions on the first query allows the system to provide actionable recovery instructions.
