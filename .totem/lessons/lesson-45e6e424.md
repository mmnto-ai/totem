## Lesson — Orchestrators must dynamically adjust max_tokens based

**Tags:** anthropic, llm, orchestrator

Orchestrators must dynamically adjust `max_tokens` based on the specific model used, as limits vary significantly within a single provider family (e.g., 4K for Haiku vs 16K for Opus). Hardcoding a single value causes API failures on smaller models or unnecessary truncation on larger ones.
