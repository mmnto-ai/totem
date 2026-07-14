# @mmnto/totem

Core engine for [Totem](https://github.com/mmnto-ai/totem) — a local-first, file-anchored substrate that makes AI-agent work queryable, enforceable, and derivable in your codebase. This is the library that [`@mmnto/cli`](https://www.npmjs.com/package/@mmnto/cli) and [`@mmnto/mcp`](https://www.npmjs.com/package/@mmnto/mcp) build on; most users want one of those instead.

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

## Entry points

The package root (`.`) is a compatibility barrel: it re-exports the full core
module graph and makes no per-symbol semver promise. It is retained unchanged
for backward compatibility.

For new code, prefer the supported subpath entry points. Each is a curated,
semver-tracked subset of the barrel:

| Entry point              | Surface                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `@mmnto/totem/config`    | `TotemConfig` and the config-schema surface (schemas, tiers, defaults).                     |
| `@mmnto/totem/packs`     | Pack registration + load: `PackRegistrationAPI`, `loadInstalledPacks`, the manifest schema. |
| `@mmnto/totem/lessons`   | Lesson read/write, frontmatter parse/build, and the role/frontmatter schema contracts.      |
| `@mmnto/totem/artifacts` | The verdict-artifact schema, its content-address-verified loader, and version constants.    |

```typescript
import type { TotemConfig } from '@mmnto/totem/config';
import { loadInstalledPacks } from '@mmnto/totem/packs';
```

Symbols on the supported subpaths are also present on the root barrel; the
subpaths narrow that surface to an intentional set. Subtraction from the barrel
is deferred to a future major (mmnto-ai/totem#2336).

## Docs

- Repository: <https://github.com/mmnto-ai/totem>

Apache-2.0.
