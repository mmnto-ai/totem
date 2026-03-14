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
      shield: 'gemini-3.1-pro-preview',
    }
  }
}
```

## Local Models (Ollama)

Totem fully supports local execution for environments operating under the Air-Gapped Doctrine.

Ensure Ollama is installed and running (`ollama serve`). You can configure Totem to use Ollama for both embeddings (syncing) and orchestration (generation).

```typescript
export default {
  embedding: { 
    provider: 'ollama', 
    model: 'nomic-embed-text' 
  },
  orchestrator: {
    provider: 'ollama',
    defaultModel: 'llama3', // or 'deepseek-coder'
    // Optional: Override context window size
    options: { num_ctx: 16384 } 
  }
}
```

## Hybrid Search & Reranking

Totem's file resolver natively combines Full-Text Search (FTS) and vector similarity, using Reciprocal Rank Fusion (RRF) to provide highly accurate retrieval. This requires no extra configuration, but you can explicitly filter knowledge by querying for specific ContentTypes.

Example target configurations in `totem.config.ts`:
```typescript
targets: [
  { glob: 'packages/**/*.ts', type: 'code', strategy: 'typescript-ast' },
  { glob: 'README.md', type: 'spec', strategy: 'markdown-heading' },
  { glob: '.totem/lessons/*.md', type: 'lesson', strategy: 'markdown-heading' },
]
```

## Custom Prompt Overrides

If you want to fundamentally change how a Totem command behaves (e.g., changing the persona or output format of `totem shield`), you do not need to modify the source code.

You can override any command's system prompt by creating a markdown file in `.totem/prompts/`.
- Example: Creating `.totem/prompts/shield.md` will completely override the default instruction set for the `shield` command.

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
