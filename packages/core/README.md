# @mmnto/totem

Core engine for [Totem](https://github.com/mmnto-ai/totem), a persistent memory and context layer for AI agents. This is the library that [`@mmnto/cli`](https://www.npmjs.com/package/@mmnto/cli) and [`@mmnto/mcp`](https://www.npmjs.com/package/@mmnto/mcp) build on; most users want one of those instead.

It contains the lesson parsing and compilation substrate, the deterministic rule engine (regex, Tree-sitter AST classification, ast-grep), the LanceDB-backed vector store, chunkers and embedders, and pack manifest helpers.

## Install

```bash
pnpm add @mmnto/totem
```

Requires Node >= 24. `@google/genai` is an optional peer dependency, used when Gemini is configured as the embedder.

## Usage

```typescript
import { LanceStore, createEmbedder, createChunker } from '@mmnto/totem';
```

See the [architecture reference](https://github.com/mmnto-ai/totem/blob/main/docs/reference/architecture.md) for how the pieces fit together.

## Docs

- Repository: <https://github.com/mmnto-ai/totem>

Apache-2.0.
