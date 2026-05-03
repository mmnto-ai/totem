# Supported Models & AI Tools Reference

> **Last validated:** 2026-05-02 (1.25.0 ship state)

Totem supports four LLM provider families for orchestration, and exports project
knowledge to all major AI coding tools. This document tracks model IDs, tool
config paths, and strategies for keeping everything current.

---

## Orchestrator Models (LLM Calls)

Used by `totem review`, `totem spec`, `totem triage`, `totem extract`, etc.

### Google Gemini

| Role                | Model ID                         | Notes                                        |
| ------------------- | -------------------------------- | -------------------------------------------- |
| Default (fast)      | `gemini-3-flash-preview`         | Preview — current Totem default              |
| Pro (complex tasks) | `gemini-3.1-pro-preview`         | Replaced `gemini-3-pro-preview` (March 2026) |
| Image generation    | `gemini-3.1-flash-image-preview` | Flash variant optimized for image tasks      |
| Fast-lite (newest)  | `gemini-3.1-flash-lite`          | 2.5x faster TTFT than Flash, lowest cost     |
| Stable fast         | `gemini-2.5-flash`               | GA — **deprecating June 17, 2026**           |
| Stable pro          | `gemini-2.5-pro`                 | GA — **deprecating June 17, 2026**           |

**Listing API:** `GET https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY`

- Auth: API key as query parameter
- Docs: https://ai.google.dev/api/models
- Note: `gemini-3-pro-preview` was discontinued March 26, 2026. Use `gemini-3.1-pro-preview`.

### Anthropic (Claude)

| Role              | Model ID            | Dated Snapshot               | Notes                                          |
| ----------------- | ------------------- | ---------------------------- | ---------------------------------------------- |
| Flagship          | `claude-opus-4-7`   | (undated alias)              | 1M context, Jan 2026 cutoff, adaptive thinking |
| Previous Opus     | `claude-opus-4-6`   | (undated alias)              | 1M context, May 2025 cutoff, still available   |
| Fast/balanced     | `claude-sonnet-4-6` | (undated alias)              | Default for `totem compile` routing            |
| Cheapest          | `claude-haiku-4-5`  | `claude-haiku-4-5-20251001`  |                                                |
| Legacy Opus       | `claude-opus-4-5`   | Still available              |                                                |
| Legacy Sonnet 4.5 | `claude-sonnet-4-5` | `claude-sonnet-4-5-20250929` |                                                |
| Legacy Sonnet 4   | `claude-sonnet-4-0` | `claude-sonnet-4-20250514`   |                                                |

**Listing API:** `GET https://api.anthropic.com/v1/models`

- Auth: `X-Api-Key` header + `anthropic-version: 2023-06-01`
- Docs: https://docs.anthropic.com/en/docs/about-claude/models
- Note: Anthropic does **not** offer an embedding model.

**Migrating to Claude Opus 4.7.** Behaviour changes if you switch any override from 4.6 to 4.7:

1. `temperature`, `top_p`, and `top_k` now return 400 errors. Strip sampling params from orchestrator calls. Tracked for Totem in [#1476](https://github.com/mmnto-ai/totem/issues/1476) (seven internal call sites still pass `temperature`, latent until an override points at 4.7).
2. `extended_thinking` is replaced by `adaptive_thinking`, steered via the `effort: low | medium | high | xhigh | max` parameter. Totem does not currently use extended thinking, so no migration needed today.
3. New tokenizer adds a 1.0 to 1.35x token overhead vs 4.6 depending on content. Re-budget `max_tokens` if you previously tuned it for 4.6.

See the [Opus 4.7 migration guide](https://platform.claude.com/docs/en/about-claude/models/migration-guide) for the full list.

### OpenAI

| Role                 | Model ID                  | Notes                                 |
| -------------------- | ------------------------- | ------------------------------------- |
| Flagship             | `gpt-5.4`                 | Latest                                |
| Pro (higher compute) | `gpt-5.4-pro`             | Higher token limits                   |
| Fast/cheap           | `gpt-5.4-mini`            | Cost-optimized (succeeded gpt-5-mini) |
| Ultra-cheap          | `gpt-5.4-nano`            | Smallest (succeeded gpt-5-nano)       |
| Reasoning (best)     | `o3-pro`                  | API only — retired from ChatGPT       |
| Reasoning (fast)     | `o4-mini`                 | API only — retired from ChatGPT       |
| Previous gen         | `gpt-4.1`, `gpt-4.1-mini` | Legacy, still available in API        |

**Listing API:** `GET https://api.openai.com/v1/models`

- Auth: `Authorization: Bearer $OPENAI_API_KEY`
- Docs: https://platform.openai.com/docs/models
- Note: `gpt-4o`, `gpt-4o-mini`, `o4-mini` retired from ChatGPT (Feb 2026) but still in API.

### Ollama (Local)

Ollama runs models locally. Any model from the [Ollama library](https://ollama.com/search)
can be used as an orchestrator.

**Recommended: `gemma4`** (defaults to e4b, 9.6GB) — `totem init` auto-detects Ollama and configures gemma4 automatically. Choose the variant by task:

- **`gemma4:e4b`** (9.6GB) — Fast triage and classification. 16s triage vs 27s cloud API, equal formatting. Best cost/speed ratio.
- **`gemma4:26b`** (17GB) — Local rule compilation and spec generation. Produces correct regex with proper escaping. Unlocks the 100% offline governance loop (extract → compile → lint).

| Model           | Parameters      | Notes                                             |
| --------------- | --------------- | ------------------------------------------------- |
| **`gemma4`**    | e2b/e4b/26b/31b | **Recommended.** Google, multimodal, 128-256K ctx |
| `qwen3`         | 0.6B–235B (MoE) | Alibaba, strong reasoning                         |
| `llama3.2`      | 1B/3B/11B/90B   | Meta, vision variants available                   |
| `qwen2.5-coder` | 7B/32B          | Code-specialized                                  |
| `phi3`          | 3.8B/14B        | Microsoft, lightweight                            |

**Listing API (local):** `GET http://localhost:11434/api/tags`

- Auth: None (local server)
- Lists only downloaded models. Browse full library at https://ollama.com/search
- Docs: https://github.com/ollama/ollama/blob/main/docs/api.md

---

## Embedding Models (Vector Search)

Used by `totem sync` for indexing chunks into LanceDB.

| Provider             | Model ID                     | Dimensions | Notes                                 |
| -------------------- | ---------------------------- | ---------- | ------------------------------------- |
| **Gemini** (default) | `gemini-embedding-2-preview` | 768        | Multimodal, task-type aware retrieval |
| Gemini               | `gemini-embedding-001`       | 768        | Stable, text-only                     |
| OpenAI               | `text-embedding-3-small`     | 1536       | Lowest onboarding friction            |
| OpenAI (large)       | `text-embedding-3-large`     | 3072       | Higher quality, higher cost           |
| **Ollama** (offline) | `nomic-embed-text`           | 768        | Most popular local embed model        |
| Ollama               | `nomic-embed-text-v2-moe`    | 768        | Multilingual MoE variant              |
| Ollama               | `mxbai-embed-large`          | 1024       | BERT-large class SOTA                 |
| Ollama               | `embeddinggemma`             | 768        | 300M params, from Gemma 3, 100+ langs |
| Ollama               | `qwen3-embedding`            | varies     | 0.6B–8B, 100+ languages               |

---

## Totem Defaults

Current defaults configured in `totem.config.ts` and `packages/cli/src/commands/init.ts`:

```
Embedding:    Gemini gemini-embedding-2-preview  (or OpenAI text-embedding-3-small, Ollama nomic-embed-text)
Orchestrator: Gemini gemini-3-flash-preview  (overrides: gemini-3.1-pro-preview for spec/review/triage)
```

### Updating Defaults

When a provider releases new stable models, update these locations:

1. Core config schema — Zod embedding defaults
2. Embedder constructors — default model constant in each provider
3. Init command — config generation templates
4. Architecture docs — documentation examples
5. Root totem config — this repo's own embedding config
6. Test files — smoke, integration, and unit tests referencing specific model IDs

---

## AI Coding Tools (Export Targets)

Totem exports compiled lessons to AI coding tool config files via `totem compile --export`. Each tool reads its own file on startup.

| Tool                   | Config File                       | Export Key | Totem Support           |
| ---------------------- | --------------------------------- | ---------- | ----------------------- |
| **Claude Code**        | `CLAUDE.md`                       | `claude`   | Native (reads directly) |
| **Gemini / GCA**       | `.gemini/styleguide.md`           | —          | Native (reads directly) |
| **GitHub Copilot**     | `.github/copilot-instructions.md` | `copilot`  | Exporter                |
| **JetBrains Junie**    | `.junie/guidelines.md`            | `junie`    | Exporter                |
| **Cursor**             | `.cursorrules`                    | `cursor`   | Planned (#406)          |
| **Windsurf (Codeium)** | `.windsurfrules`                  | `windsurf` | Planned (#407)          |
| **Cline**              | `.clinerules`                     | —          | Not yet supported       |
| **Aider**              | `.aider.conf.yml`                 | —          | Not yet supported       |
| **Amazon Q**           | IDE-native                        | —          | Not yet supported       |
| **Continue.dev**       | `.continuerc.json`                | —          | Not yet supported       |

### Config Example

```typescript
// in totem.config.ts
exports: {
  copilot: '.github/copilot-instructions.md',
  junie: '.junie/guidelines.md',
  cursor: '.cursorrules',      // after #406
  windsurf: '.windsurfrules',  // after #407
}
```

### OpenAI-Compatible Providers

Any LLM provider with an OpenAI-compatible API can be used as an orchestrator
without explicit Totem support. Set `provider: 'openai'` with a custom `baseUrl`:

| Provider                | Base URL                                | Notes              |
| ----------------------- | --------------------------------------- | ------------------ |
| Groq                    | `https://api.groq.com/openai/v1`        | Fast inference     |
| Together AI             | `https://api.together.xyz/v1`           | Open-source models |
| Fireworks AI            | `https://api.fireworks.ai/inference/v1` | Low latency        |
| DeepSeek                | `https://api.deepseek.com/v1`           | Code-specialized   |
| Mistral                 | `https://api.mistral.ai/v1`             | EU-hosted          |
| Local (LM Studio, etc.) | `http://localhost:1234/v1`              | Any local server   |

---

## Model Discovery Scripts

Quick one-liners to check available models from each provider:

```bash
# Gemini — list all models
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY" | jq '.models[].name'

# Anthropic — list all models
curl -s https://api.anthropic.com/v1/models \
  -H "X-Api-Key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" | jq '.data[].id'

# OpenAI — list all models
curl -s https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY" | jq '.data[].id' | sort

# Ollama — list locally downloaded models
curl -s http://localhost:11434/api/tags | jq '.models[].name'
```
