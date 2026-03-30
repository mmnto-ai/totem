# Cross-Repo Mesh (Federation)

Most governance tools are per-repo. Totem lets you connect repositories into a shared knowledge mesh using `totem link`.

## Linking Repositories

```bash
# In your frontend repo
totem link ../api-server
```

This command configures cross-repo queries in your `totem.config.ts`:

```typescript
linkedIndexes: ['../api-server', '../shared-design-system'],
```

Now, `totem spec` and `totem review` in your frontend repo can query lessons from your API repo. An architectural mistake in one codebase becomes a rule protecting all others. Strategy docs can inform code decisions, and shared design systems can inform component repositories.

## Context Isolation (Partitions)

When multiple AI agents (or one agent across packages) share a knowledge index, you can restrict search results to specific boundaries. This prevents a frontend agent from hallucinating based on backend database schemas.

Define partitions in `totem.config.ts`:

```typescript
partitions: {
  core: ['packages/core/'],
  cli: ['packages/cli/'],
  mcp: ['packages/mcp/'],
},
```

Agents can then pass the partition name when searching via MCP:

```typescript
search_knowledge({ query: 'error handling', boundary: 'mcp' });
```

Results will be strictly restricted to `packages/mcp/` files. Unknown boundary names fall back to raw path prefix matching. Partitions work alongside `linkedIndexes` — a boundary is just a scoped slice of knowledge, whether local or remote.
