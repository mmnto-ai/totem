## Lesson — Claude Opus 4.7 rejects sampling parameters

**Tags:** anthropic, llm, api
**Scope:** docs/reference/supported-models.md, packages/cli/src/orchestrators/anthropic-orchestrator.ts

Claude Opus 4.7 returns 400 errors if temperature, top_p, or top_k are provided in the Messages API. These parameters must be stripped from orchestrator calls to prevent request failures when using this model.
