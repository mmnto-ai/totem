---
'@mmnto/cli': minor
'@mmnto/totem': minor
'@mmnto/mcp': patch
---

feat: graceful degradation for orchestrator and embedder providers

Orchestrators (Gemini, Anthropic) now fall back to their CLI equivalents when the SDK or API key is missing. Embedders fall back to Ollama when the configured provider is unavailable. LazyEmbedder uses promise memoization to prevent race conditions with concurrent embed() calls.

feat: configurable issue sources — support multiple repos in triage/extract/spec

Add `repositories` field to `totem.config.ts`. When set, triage, audit, and spec commands aggregate issues from all listed repos. Supports `owner/repo#123` syntax for disambiguation.

chore: switch default embedder to Gemini (gemini-embedding-2-preview)

Task-type aware 768d embeddings replace OpenAI text-embedding-3-small (1536d). Requires `totem sync --full` after upgrade.
