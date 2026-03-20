# Context Isolation

**Context isolation** ensures that specialized AI agents only retrieve rules and lessons relevant to the specific architectural layer they are modifying. This prevents context window bloat and cross-domain hallucinations (e.g., applying a React rendering constraint to a PostgreSQL database module).

Totem achieves context isolation via logical **Index Partitions** and the `boundary` parameter on the MCP server.

## Index Partitions (`totem.config.ts`)

You can partition your workspace's knowledge base by defining logical aliases in `totem.config.ts` that map to specific directory paths or glob patterns.

```typescript
// totem.config.ts
export default {
  // ...
  partitions: {
    core: ['packages/core/src'],
    cli: ['packages/cli/src'],
    mcp: ['packages/mcp/src'],
  },
};
```

_Note: Defining partitions does not create separate LanceDB tables. Totem maintains a single unified vector index and filters results dynamically at query time._

## The `boundary` Parameter

The `search_knowledge` MCP tool accepts an optional `boundary` array. This parameter restricts the vector search exclusively to the specified partitions or raw path prefixes.

### Resolution Logic

When an agent passes `boundary: ["core"]`, the MCP server resolves the query as follows:

1.  **Alias Lookup:** Checks if `"core"` exists as a key in the `partitions` configuration.
2.  **Filter Application:** If a match is found, it constructs a LanceDB `WHERE` clause using an SQL `LIKE` filter on the underlying file paths (e.g., `file_path LIKE 'packages/core/src/%'`).
3.  **Fallback Behavior:** If the string does not match any configured partition alias, Totem treats the string as a raw file path prefix (e.g., `boundary: ["src/utils"]` translates to `file_path LIKE 'src/utils/%'`).

## Enforcing Boundaries via Reflexes

To ensure AI agents proactively use context isolation, explicitly instruct them via your `.cursorrules` or `CLAUDE.md` files to pass the appropriate boundary parameter based on their current working directory.

**Example `.cursorrules` Instruction:**

```markdown
## Context Constraints

When investigating architectural rules or querying past lessons via the `search_knowledge` MCP tool, you MUST isolate your context to the active domain by passing the `boundary` parameter:

- If working inside `packages/core/`, use `boundary: ["core"]`
- If working inside `packages/cli/`, use `boundary: ["cli"]`
- If working inside `packages/mcp/`, use `boundary: ["mcp"]`
  Never query the global knowledge base without a boundary unless explicitly asked.
```

By enforcing this reflex, sub-agents are mathematically starved of irrelevant context, guaranteeing strict architectural isolation per layer.
