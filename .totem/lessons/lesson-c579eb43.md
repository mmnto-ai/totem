## Lesson — Validate embedding dimensions across federated stores

**Tags:** mcp, embeddings, validation
**Scope:** packages/mcp/src/context.ts

Vector search across federated stores requires identical embedding dimensions. Validating provider and model dimensions during initialization prevents runtime errors during semantic score merging.
