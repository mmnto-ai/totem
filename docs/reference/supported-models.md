# Supported Models & AI Tools Reference

> **Last validated:** 2026-07-14 (model-refresh PR: Gemini, Anthropic, and OpenAI orchestrator tiers re-validated against published provider docs; Totem defaults moved to `gemini-3.5-flash` / `claude-sonnet-5`; sampling-param stripping now handled at the orchestrator boundary).

Totem supports four LLM provider families for orchestration, and exports project
knowledge to all major AI coding tools. This document tracks model IDs, tool
config paths, and strategies for keeping everything current.

---

## Orchestrator Models (LLM Calls)

Used by `totem review`, `totem spec`, `totem triage`, `totem lesson extract`, etc.

### Google Gemini

| Role                | Model ID                         | Notes                                                                                                                                            |
| ------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Flagship (agentic)  | `gemini-3.5-flash`               | GA flagship — coding/agentic; **Totem's default for all Gemini roles since 2026-07-14** ($1.50/$9 flat; beats 3.1 Pro on coding/agentic)         |
| Previous default    | `gemini-3-flash-preview`         | Preview — superseded as Totem default by `gemini-3.5-flash`                                                                                      |
| Pro (complex tasks) | `gemini-3.1-pro-preview`         | Replaced `gemini-3-pro-preview` (March 2026). Still preview-only; $2/$12 (→$4/$18 >200k). Fallback if Flash prose quality regresses on docs/spec |
| Image generation    | `gemini-3.1-flash-image-preview` | Flash variant optimized for image tasks                                                                                                          |
| Fast-lite (newest)  | `gemini-3.1-flash-lite`          | 2.5x faster TTFT than Flash, lowest cost                                                                                                         |
| Stable fast         | `gemini-2.5-flash`               | GA — **deprecating June 17, 2026**                                                                                                               |
| Stable pro          | `gemini-2.5-pro`                 | GA — **deprecating June 17, 2026**                                                                                                               |

**Listing API:** `GET https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY`

- Auth: API key as query parameter
- Docs: https://ai.google.dev/api/models
- Note: `gemini-3-pro-preview` was discontinued March 26, 2026. Use `gemini-3.1-pro-preview`.
- **Gemini CLI → Antigravity (`agy`):** Google is retiring the Gemini CLI and Gemini Code Assist IDE extensions for consumer (AI Pro / Ultra / free) usage on **June 18, 2026**, folding them into the Antigravity platform (enterprise retains access). `gemini-3.5-flash` is reachable via the Gemini API and Antigravity. Note: Antigravity's `agy` is an _agentic_ CLI (a harness, not a one-shot `-o json` completion tool), so it is **not** a drop-in shell-provider orchestrator target — integration is TBD.

### Anthropic (Claude)

| Role            | Model ID                                  | Dated Snapshot                                            | Notes                                                                                                                                                       |
| --------------- | ----------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top tier        | `claude-fable-5`                          | (undated alias)                                           | Most capable; premium pricing ($10/$50); rejects sampling params                                                                                            |
| Flagship Opus   | `claude-opus-4-8`                         | (undated alias)                                           | 1M context, adaptive thinking; rejects sampling params                                                                                                      |
| Fast/balanced   | `claude-sonnet-5`                         | (undated alias)                                           | **Totem default for `compile` + the Anthropic review lane since 2026-07-14.** $3/$15 (intro $2/$10 through 2026-08-31); rejects non-default sampling params |
| Previous Opus   | `claude-opus-4-7`                         | (undated alias)                                           | 1M context, Jan 2026 cutoff; rejects sampling params                                                                                                        |
| Previous Sonnet | `claude-sonnet-4-6`                       | (undated alias)                                           | Previous Totem compile/review default; accepts sampling params                                                                                              |
| Cheapest        | `claude-haiku-4-5`                        | `claude-haiku-4-5-20251001`                               |                                                                                                                                                             |
| Legacy Opus     | `claude-opus-4-5` / `claude-opus-4-6`     | Still available                                           |                                                                                                                                                             |
| Legacy Sonnet   | `claude-sonnet-4-5` / `claude-sonnet-4-0` | `claude-sonnet-4-5-20250929` / `claude-sonnet-4-20250514` |                                                                                                                                                             |

**Listing API:** `GET https://api.anthropic.com/v1/models`

- Auth: `X-Api-Key` header + `anthropic-version: 2023-06-01`
- Docs: https://docs.anthropic.com/en/docs/about-claude/models
- Note: Anthropic does **not** offer an embedding model.

**Current-generation param constraints (Opus 4.7+ / Sonnet 5+ / Fable).** These families reject client sampling params (`temperature`, `top_p`, `top_k`) with a 400:

1. **Handled at the orchestrator boundary since 2026-07-14** ([#1476](https://github.com/mmnto-ai/totem/issues/1476)): `modelStripsTemperature()` gates the param in the anthropic and openai orchestrators, so callers keep declaring intent and the boundary omits it for models that reject it. No per-call-site changes needed when pointing an override at a new family.
2. `extended_thinking` is replaced by `adaptive_thinking`, steered via the `effort: low | medium | high | xhigh | max` parameter. Totem does not currently use extended thinking, so no migration needed today.
3. The Opus 4.7+ / Sonnet 5 tokenizers add a 1.0 to 1.35x token overhead vs 4.6 depending on content. Re-budget `max_tokens` if you previously tuned it for 4.6.

See the [model migration guide](https://platform.claude.com/docs/en/about-claude/models/migration-guide) for the full list.

### OpenAI

| Role               | Model ID                  | Notes                                                                      |
| ------------------ | ------------------------- | -------------------------------------------------------------------------- |
| Flagship           | `gpt-5.6-sol`             | GA July 2026 (alias `gpt-5.6`) — frontier reasoning + long-horizon agentic |
| Balanced           | `gpt-5.6-terra`           | GPT-5.5-competitive at ~2x lower cost                                      |
| Fast/cheap         | `gpt-5.6-luna`            | Fastest and most affordable 5.6-family model                               |
| Previous flagship  | `gpt-5.4` / `gpt-5.4-pro` | Still available in API                                                     |
| Reasoning (legacy) | `o3-pro`, `o4-mini`       | API only — retired from ChatGPT                                            |
| Previous gen       | `gpt-4.1`, `gpt-4.1-mini` | Legacy, still available in API                                             |

**Listing API:** `GET https://api.openai.com/v1/models`

- Auth: `Authorization: Bearer $OPENAI_API_KEY`
- Docs: https://platform.openai.com/docs/models
- Note: `gpt-4o`, `gpt-4o-mini`, `o4-mini` retired from ChatGPT (Feb 2026) but still in API.
- **Param constraints:** every `gpt-5*` and o-series model rejects `max_tokens` (requires `max_completion_tokens`) and rejects non-default `temperature`. Handled at the openai-orchestrator boundary since 2026-07-14 via `modelStripsTemperature()` — GPT models work as spec/review/lane orchestrators out of the box; OpenAI-compatible local servers (Ollama, LM Studio, Groq) keep the legacy `max_tokens` shape. "Codex" is OpenAI's coding agent surface, not a model ID — the mainline `gpt-5.5+` models ship in Codex directly.

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

| Provider             | Model ID                     | Dimensions | Notes                                                                                              |
| -------------------- | ---------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| **Gemini** (default) | `gemini-embedding-2-preview` | 768        | Multimodal, task-type aware retrieval                                                              |
| Gemini (GA)          | `gemini-embedding-2`         | 768        | GA successor to the preview — **swapping requires a full re-index** (deferred, tracked separately) |
| Gemini               | `gemini-embedding-001`       | 768        | Stable, text-only                                                                                  |
| OpenAI               | `text-embedding-3-small`     | 1536       | Lowest onboarding friction                                                                         |
| OpenAI (large)       | `text-embedding-3-large`     | 3072       | Higher quality, higher cost                                                                        |
| **Ollama** (offline) | `nomic-embed-text`           | 768        | Most popular local embed model                                                                     |
| Ollama               | `nomic-embed-text-v2-moe`    | 768        | Multilingual MoE variant                                                                           |
| Ollama               | `mxbai-embed-large`          | 1024       | BERT-large class SOTA                                                                              |
| Ollama               | `embeddinggemma`             | 768        | 300M params, from Gemma 3, 100+ langs                                                              |
| Ollama               | `qwen3-embedding`            | varies     | 0.6B–8B, 100+ languages                                                                            |

---

## Totem Defaults

Current defaults configured in `totem.config.ts` and `packages/cli/src/commands/init.ts`:

```
Embedding:    Gemini gemini-embedding-2-preview  (or OpenAI text-embedding-3-small, Ollama nomic-embed-text)
Orchestrator: per-role overrides (no ambient default — Tenet-16 corollary):
              gemini-3.5-flash for docs/spec/shield/triage/extract/reviewlearn,
              anthropic:claude-sonnet-5 for compile;
              review.lanes: anthropic:claude-sonnet-5 + gemini:gemini-3.5-flash
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

Totem exports compiled lessons to AI coding tool config files via `totem lesson compile --export`. Each tool reads its own file on startup.

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
