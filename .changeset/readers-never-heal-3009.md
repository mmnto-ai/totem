---
'@mmnto/totem': minor
'@mmnto/mcp': patch
'@mmnto/cli': patch
---

A reader never heals the vector store (mmnto-ai/totem#3009). Before this change, `LanceStore.connect()` deleted the whole `.lancedb/` directory whenever its open failed with an error it judged healable (version mismatch, corruption, schema, `lance error`, `not found` and similar), whichever command was opening it. A search, `totem stats`, the MCP server's `search_knowledge` or an extract could wipe a store it only meant to read, including a linked repository's store.

What flips:

- `connect()` takes `options?: { heal?: boolean }`, and the default is now `heal: false`. On a store that only a rebuild can repair it throws `StoreNeedsRebuildError` (code `STORE_NEEDS_REBUILD`, exported from `@mmnto/totem`) and leaves the directory untouched. The error carries `dbPath`, `reason` (`'healable-open-error'` or `'dimension-mismatch'`), the stored and expected vector widths when known, and the underlying error's message. Its message ends with the cure: run `totem sync --full` in that repository.
- `connect({ heal: true })` behaves exactly as the old default did: it warns, deletes the store and opens an empty one. The sync pipeline is the one rebuilder, and it is the only caller that passes it.
- `reconnect()` calls `connect()` with the default, so it no longer heals either. Every `reconnect()` caller is on the reader side (the MCP server after a sync, and its per-query retry).
- The MCP server and `totem search` skip a linked store that throws `StoreNeedsRebuildError`, with one warning that names the link, its root, the reason and the cure (printed once). The store is never deleted, and the search runs over the stores that opened. In the MCP server the warning arrives the usual way for linked-index init errors, on the first `search_knowledge` call. The skipped store is kept as pending: the server's reconnect (after `add_lesson`'s sync, or the retry after a failed search) tries it again, and once a `totem sync --full` in that repository has rebuilt it, it rejoins the federation and its warning is cleared. Otherwise it stays skipped until the server restarts.
- In the MCP server a fault in the primary store is an error that names the cure for `search_knowledge`, the tool that reads the store. `describe_project` already falls back to loading the config directly when the full context fails, so it still answers. `verify_execution` no longer opens the store, so it still runs. `add_lesson` still writes the lesson and runs its sync, which rebuilds the store, and its result says so.
- Syncs embedded in other commands still rebuild: the incremental sync `totem review --learn` runs after its dedup lookup (whose store fault is non-fatal), and the MCP `add_lesson` tool's own sync. Commands that open the store before their embedded sync, such as `totem review-learn` and `totem lesson extract`, now stop with the error and its cure before writing anything.
- The strict pre-push shield gate (`totem review` in standard mode) opens the store for retrieval. On a store fault it now fails closed and loud, exiting 1 with the cure, where before it reviewed against a silently emptied index.

A caller that relied on the old default passes `{ heal: true }`.

The dimension-mismatch detector inside `connect()` is unchanged. It compares widths only when the stored vector reads as a plain array, and LanceDB returns an Arrow vector, so today it never fires. Mismatches are still reported by `search_knowledge`'s health check. The detector fix is tracked separately. Once it is fixed, a reader throws `StoreNeedsRebuildError` with `reason: 'dimension-mismatch'` on that arm too.
