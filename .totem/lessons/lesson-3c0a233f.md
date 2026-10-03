## Lesson — A linked store needing a rebuild is skipped, not repaired

**Tags:** mcp, store, fault-tolerance
**Scope:** packages/mcp/src/context.ts

When a linked index throws `StoreNeedsRebuildError` at init, the MCP server records it, skips it with one warning line that names the index, its root and the cure, and leaves its files untouched. The skipped store is retried on a later reconnect, so it comes back once a sync in its own repository has rebuilt it. A fault in the primary store still fails the read tools; `verify_execution` and `add_lesson` survive it, because neither needs the store to do its work (mmnto-ai/totem#3012).
