## Lesson — A reader never heals the vector store

**Tags:** store, lancedb, reliability
**Scope:** packages/core/src/store/lance-store.ts

`connect()` on the vector store throws `StoreNeedsRebuildError`, carrying the cure, when the store can only be repaired by a rebuild. It no longer deletes and recreates the store by default, and `reconnect()` does not heal either. Only the sync pipeline asks for the heal. Before this, opening a store to read it could wipe it (mmnto-ai/totem#3012). The rule behind it: a tool declared read-only does not repair what it reads.
