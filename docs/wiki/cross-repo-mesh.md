# Cross-Repo Mesh (Federation)

Most governance tools operate in isolation per repository. Totem lets you connect multiple repositories into a shared semantic knowledge mesh, allowing your agents to federate context across repository boundaries.

## Two ways to share lessons across repositories

Totem ships **two distinct mechanisms** for cross-repository knowledge sharing. They sound similar but have very different tradeoffs — pick the one that matches your use case.

### Option 1: `linkedIndexes` config (federation mode)

Each repository keeps its own `.lancedb` index. Queries fan out across multiple stores in parallel and merge results by rank. The lessons in linked repositories stay in their home repos; you query them remotely.

**Best for:** distinct repositories with their own lesson corpora, where you want each repo to maintain its own governance authority but cross-pollinate semantic context.

### Option 2: `totem link <path>` CLI — pull mode

Adds the neighboring repo's `.totem/lessons/*.md` files to your local `targets: []` array in `totem.config.ts`. After running `totem sync`, those lessons get **embedded into your local LanceDB index** alongside your own. The neighboring repo's index is not queried at all — its lessons become part of yours.

**Best for:** tightly coupled repositories that share a single lesson corpus (e.g., a monorepo with multiple packages, or a parent project with first-party plugins). Your local index becomes the single source of truth.

```bash
# Pull neighboring repo's lessons into your local index
totem link ../api-server

# Remove the link
totem link --unlink ../api-server
```

Note: `totem link` modifies the `targets: []` array, NOT `linkedIndexes`. The two mechanisms are independent — you can use both at the same time on different neighboring repos if your needs vary.

### Configuring `linkedIndexes` (federation mode)

To set up federation, hand-edit your `totem.config.ts` and add the paths to the sibling repositories:

```typescript
export default {
  // ... other config ...
  linkedIndexes: ['../api-server', '/absolute/path/to/shared-design-system'],
};
```

**Prerequisite:** Every linked repository must be Totem-managed (it must have its own `totem.config.ts`) and must have a populated `.lancedb` index.

### Embedding Dimension Requirement

Because each linked store is queried with the same embedding pipeline and results are then merged by rank (RRF), **every linked repository must use the same embedding provider, model, and dimensions as the primary repository.** The query embedding (a single vector) must be compatible with each store's index shape for the per-store search to even run; results are then merged by rank position rather than by raw cosine similarity in a shared space.

If your primary repo uses a 768-dimension embedder and a linked repo uses a 1536-dimension embedder, cross-repo semantic search will fail.

If you see a `Linked index embedder dimension mismatch` warning on your first `search_knowledge` call (init failures are caught and surfaced as warnings on the first query, not at server startup), the linked repository is producing vectors of a different size than the primary:

1. Align the `totem.config.ts` embedding settings in the linked repository to match the primary.
2. Run `rm -rf .lancedb && totem sync --full` in the linked repository to rebuild its index with the correct dimensions.

## Federated Queries (Default)

When an agent calls the `search_knowledge` tool without specifying a boundary, the query automatically fans out to the primary index and all configured linked indexes in parallel.

The results from all stores are merged using **rank-based RRF scoring** with a constant of `k=60`. Each store is treated as an independently ranked list, and each result is assigned a normalized score based on its 1-indexed position within its store: `1 / (60 + rank_within_store)`. So the top result of any store gets `1/61 ≈ 0.0164`, the second gets `1/62`, and so on. This produces correctly interleaved ranks regardless of how the underlying store scored its own results.

This is a simplified form of Reciprocal Rank Fusion. The textbook RRF formula sums reciprocal ranks across multiple lists when the same document appears in more than one. Federation across linked Totem repositories assumes **disjoint corpora** — each document lives in exactly one store, distinguished by its `sourceRepo` tag — so the cross-list summation degenerates to a single per-list rank score. If you ever link two repositories that share content (e.g., a vendored submodule indexed in both), each copy would be treated as a separate document at its own rank within its source store, not deduplicated.

This mathematical normalization eliminates score-scale bias. It ensures that a highly relevant hit from a purely vector-based linked store isn't outranked by a mediocre hit from a hybrid-search primary store just because their absolute scoring scales differ. The visible `Score:` field in the agent's results displays this normalized RRF value.

## Targeted Queries (Boundary Routing)

Agents can explicitly route queries to specific boundaries to isolate context:

```typescript
search_knowledge({ query: 'error handling', boundary: 'api-server' });
```

**Link Name Derivation:** The name of a linked store is derived by taking the `basename` of its resolved absolute path and stripping any leading dots. For example:

- `.strategy` becomes `'strategy'`
- `../totem-playground` becomes `'totem-playground'`

**Resolution Order:** When a boundary is provided, Totem resolves it in this strict order:

1.  **Partition Name:** If it matches a local `partitions` key in config, search the primary store with a path prefix filter.
2.  **Linked Store Name:** If it matches a derived link name, route the query **only** to that specific linked store.
3.  **Broken Linked Store:** If it matches a linked store that failed to initialize, return an explicit `isError: true` response to the agent. It does **not** silently fall back to searching the primary store.
4.  **Raw Path Prefix:** If it matches none of the above, treat it as a raw path prefix (e.g., `src/components/`) on the primary store.

## Runtime Failures and Warnings

The Context Mesh is designed to degrade gracefully but loudly.

Failures are handled **per-query**, not session-global. If a linked store experiences a transient failure (e.g., its database is temporarily locked by a concurrent `totem sync`), the MCP server will:

1.  Attempt the search.
2.  On failure, attempt to seamlessly reconnect to the store and retry the search.
3.  On a second failure, append a `[SYSTEM WARNING]` to the query results notifying the agent that the specific linked store was unreachable for that turn, and continue serving the partial results from the healthy stores.

If the primary store AND every single linked store fail, the response is an explicit `isError: true` tool failure, preventing the agent from mistaking an outage for "no results found."

## Troubleshooting

| Error / Warning                                                                                      | Meaning                                                                    | Resolution                                                                              |
| :--------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| **"Linked index has no totem.config.ts"**                                                            | The linked directory is not Totem-managed.                                 | Run `totem init` in the target repository.                                              |
| **"Linked index is empty (0 rows)"**                                                                 | The link is valid, but the database has no data.                           | Run `totem sync` in the linked repository.                                              |
| **"Linked index embedder dimension mismatch"**                                                       | The linked repo produces a different embedding dimension than the primary. | Align the `totem.config.ts` embedding dimensions/settings and rebuild the linked index. |
| **"DIMENSION MISMATCH: Index has X-dim vectors but the configured embedder produces Y-dim vectors"** | The _primary_ repository's index is stale relative to its config.          | Run `rm -rf .lancedb && totem sync --full` in the primary repo.                         |
| **"Another linked index already claims the name X"**                                                 | Two paths in `linkedIndexes` resolve to the same basename.                 | Rename one of the linked directories on disk.                                           |

## When to use the Context Mesh

- **Strategy Repositories:** If you keep your ADRs and design tenets in a separate repository (like `.strategy`), link it so those architectural decisions inform code generation in the main repository.
- **Shared Design Systems:** Link a centralized UI component repository so downstream applications automatically receive structural rules about component usage.
- **Monorepo vs. Mesh:** If your code lives in a single monorepo, use **Partitions** to isolate context. If your code is spread across physically distinct repositories that cannot be merged, use the **Context Mesh**.

_(Note: Federated queries incur a slight performance overhead, roughly ~50–100 ms per linked store. The mesh is designed to link 2-5 tightly coupled repositories, not 20 independent ones.)_

---

## Context Isolation (Partitions)

_Partitions work orthogonally to the mesh — they scope results within the primary store, whereas the mesh federates across multiple stores. (Linked stores are currently searched in their entirety; partition filters are not propagated to linked-store queries.)_

When multiple AI agents (or one agent across packages) share a knowledge index, you can restrict search results to specific boundaries. This prevents a frontend agent from hallucinating based on backend database schemas.

Define partitions in `totem.config.ts`:

```typescript
partitions: {
  core: ['packages/core/'],
  cli: ['packages/cli/'],
  mcp: ['packages/mcp/'],
},
```
