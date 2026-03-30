# Supported Models & AI Tools Reference

> **Last validated:** 2026-03-12

Totem supports four LLM provider families for orchestration, and exports project
knowledge to all major AI coding tools. This document tracks model IDs, tool
config paths, and strategies for keeping everything current.

---

## Orchestrator Models (LLM Calls)

Used by `totem review`, `totem spec`, `totem triage`, `totem extract`, etc.

### Google Gemini

| Role                | Model ID                 | Notes                                            |
| ------------------- | ------------------------ | ------------------------------------------------ |
| Default (fast)      | `gemini-3-flash-preview` | Preview — current Totem default                  |
| Pro (complex tasks) | `gemini-3.1-pro-preview` | Preview — used for spec/review/triage overrides  |
| Stable fast         | `gemini-2.5-flash`       | GA release, used in smoke/eval tests             |
| Stable pro          | `gemini-2.5-pro`         | GA release                                       |
| Fast-lite (newest)  | `gemini-3.1-flash-lite`  | Released 2026-03-03, 2.5x faster TTFT than Flash |
| Ultra-cheap         | `gemini-2.5-flash-lite`  | Minimal cost                                     |

**Listing API:** `GET https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY`

- Auth: API key as query parameter
- Docs: https://ai.google.dev/api/models

### Anthropic (Claude)

| Role              | Model ID            | Dated Snapshot               |
| ----------------- | ------------------- | ---------------------------- |
| Flagship          | `claude-opus-4-6`   | Latest Opus                  |
| Fast/balanced     | `claude-sonnet-4-6` | Latest Sonnet                |
| Cheapest          | `claude-haiku-4-5`  | `claude-haiku-4-5-20251001`  |
| Legacy Sonnet 4.5 | `claude-sonnet-4-5` | `claude-sonnet-4-5-20250929` |
| Legacy Sonnet 4   | `claude-sonnet-4-0` | `claude-sonnet-4-20250514`   |

**Listing API:** `GET https://api.anthropic.com/v1/models`

- Auth: `X-Api-Key` header + `anthropic-version: 2023-06-01`
- Docs: https://docs.anthropic.com/en/docs/about-claude/models
- Note: Anthropic does **not** offer an embedding model.

### OpenAI

| Role                 | Model ID                  | Notes                    |
| -------------------- | ------------------------- | ------------------------ |
| Flagship             | `gpt-5.4`                 | Latest                   |
| Pro (higher compute) | `gpt-5.4-pro`             | Higher token limits      |
| Fast/cheap           | `gpt-5-mini`              | Cost-optimized           |
| Ultra-cheap          | `gpt-5-nano`              | Smallest                 |
| Reasoning (best)     | `o3-pro`                  | Slow but powerful        |
| Reasoning (fast)     | `o4-mini`                 | Cost-efficient reasoning |
| Previous gen         | `gpt-4o`, `gpt-4o-mini`   | Legacy, still available  |
| Previous gen         | `gpt-4.1`, `gpt-4.1-mini` | Still available          |

**Listing API:** `GET https://api.openai.com/v1/models`

- Auth: `Authorization: Bearer $OPENAI_API_KEY`
- Docs: https://platform.openai.com/docs/models

### Ollama (Local)

Ollama runs models locally. Any model from the [Ollama library](https://ollama.com/search)
can be used as an orchestrator. Popular choices:

| Model           | Parameters  | Notes                  |
| --------------- | ----------- | ---------------------- |
| `llama3.1`      | 8B/70B/405B | Meta's flagship        |
| `qwen2.5-coder` | 7B/32B      | Code-specialized       |
| `phi3`          | 3.8B/14B    | Microsoft, lightweight |

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
| **Ollama** (offline) | `nomic-embed-text`           | 768        | 56M+ pulls, most popular local        |
| Ollama               | `mxbai-embed-large`          | 1024       | BERT-large class SOTA                 |
| Ollama               | `qwen3-embedding`            | varies     | Newest, fast-growing                  |

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

Totem exports compiled lessons to AI coding tool config files via `totem compile --export`
(also runs automatically as Step 5 of `totem wrap`). Each tool reads its own file on startup.

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
