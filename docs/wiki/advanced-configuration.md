# Advanced Configuration

This guide details advanced capabilities and edge-case configurations for the `totem.config.ts` file.

## Cross-Provider Routing (BYOSD)

Totem uses a "Bring Your Own SDK" (BYOSD) pattern to keep the core CLI lightweight. You must install the SDK for your chosen provider as a dev dependency.

```bash
# If using provider: 'gemini'
pnpm add -D @google/genai

# If using provider: 'anthropic'
pnpm add -D @anthropic-ai/sdk

# If using provider: 'openai' (or local/Ollama)
pnpm add -D openai
```

You can route specific commands to different models or entirely different providers using the `provider:model` syntax in the `overrides` block.

```typescript
// totem.config.ts
export default {
  orchestrator: {
    provider: 'gemini',
    defaultModel: 'gemini-3-flash-preview',
    overrides: {
      // Use Anthropic specifically for deep architectural specs
      spec: 'anthropic:claude-3-7-sonnet-latest',
      review: 'gemini-3.1-pro-preview',
    },
  },
};
```

## Embedding Providers

The embedding provider determines how Totem converts your code and lessons into searchable vectors. The choice affects search quality, storage size, and whether you need an internet connection.

### Provider Comparison

| Provider   | Model                        | Dimensions | Task-Type Aware | Air-Gapped | Best For                          |
| :--------- | :--------------------------- | :--------- | :-------------- | :--------- | :-------------------------------- |
| **OpenAI** | `text-embedding-3-small`     | 1536       | No              | No         | Quick setup, lowest friction      |
| **Gemini** | `gemini-embedding-2-preview` | 768        | Yes             | No         | Best quality — code-aware vectors |
| **Ollama** | `nomic-embed-text`           | 768        | No              | Yes        | Air-gapped / offline environments |

### Why Gemini Embeddings (Recommended)

Gemini's `gemini-embedding-2-preview` supports **task-type instructions** — it produces different vectors depending on what you're embedding:

- `code_retrieval` for TypeScript/code chunks — understands syntax structure
- `retrieval_document` for lessons and docs — optimized for semantic search
- `retrieval_query` for search queries — asymmetric matching against documents

This means your code searches are more precise than generic text embeddings. The 768-dimension vectors also use **half the storage** of OpenAI (3GB vs 6GB per million vectors) with **2x search speed** and less than 1% accuracy loss.

```typescript
// totem.config.ts — Gemini embeddings (recommended)
embedding: {
  provider: 'gemini',
  model: 'gemini-embedding-2-preview',
}
```

Requires `GEMINI_API_KEY` in your `.env` file.

### OpenAI (Default)

The simplest setup — works out of the box if you have an OpenAI key.

```typescript
// totem.config.ts — OpenAI embeddings (default)
embedding: {
  provider: 'openai',
  model: 'text-embedding-3-small',
}
```

Requires `OPENAI_API_KEY` in your `.env` file.

### Switching Providers

Switching embedding providers requires a full re-index because vector dimensions change:

```bash
rm -rf .lancedb
pnpm exec totem sync --full
```

You must also **restart any running MCP servers** (close and reopen your AI agent) — the MCP server caches the embedder on first request.

## Local Models (Ollama)

Totem fully supports local execution for environments operating under the Air-Gapped Doctrine.

Ensure Ollama is installed and running (`ollama serve`). You can configure Totem to use Ollama for both embeddings (syncing) and orchestration (generation).

```typescript
export default {
  embedding: {
    provider: 'ollama',
    model: 'nomic-embed-text',
  },
  orchestrator: {
    provider: 'ollama',
    defaultModel: 'llama3', // or 'deepseek-coder'
    // Optional: Override context window size
    options: { num_ctx: 16384 },
  },
};
```

## Hybrid Search & Reranking

Totem's file resolver natively combines Full-Text Search (FTS) and vector similarity, using Reciprocal Rank Fusion (RRF) to provide highly accurate retrieval. This requires no extra configuration, but you can explicitly filter knowledge by querying for specific ContentTypes.

Example target configurations in `totem.config.ts`:

```typescript
targets: [
  { glob: 'packages/**/*.ts', type: 'code', strategy: 'typescript-ast' },
  { glob: 'README.md', type: 'spec', strategy: 'markdown-heading' },
  { glob: '.totem/lessons/*.md', type: 'lesson', strategy: 'markdown-heading' },
];
```

## Custom Prompt Overrides

If you want to fundamentally change how a Totem command behaves (e.g., changing the persona or output format of `totem review`), you do not need to modify the source code.

You can override any command's system prompt by creating a markdown file in `.totem/prompts/`.

- Example: Creating `.totem/prompts/review.md` will completely override the default instruction set for the `review` command.

## Export Targets (JetBrains Junie / Cursor)

Totem can automatically export its compiled architectural rules as localized files that specific IDE agents expect.

```typescript
// totem.config.ts
exports: {
  // Junie loads this as an on-demand skill rather than injecting it into every prompt
  junie: '.junie/skills/totem-rules/rules.md',
  copilot: '.github/copilot-instructions.md'
}
```

## Exporting the MCP Server

By default, the MCP integration runs via `npx -y @mmnto/mcp`, which always fetches the latest version. For teams requiring deterministic, immutable builds, you can pin the MCP server version:

1. Install it locally: `pnpm add -D @mmnto/mcp`
2. Remove the `-y` flag from your MCP config (e.g., `.mcp.json` or `.claude/settings.local.json`).
3. `npx` will now execute the exact version locked in your `package.json`.
