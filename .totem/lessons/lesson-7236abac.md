## Lesson — Thread system prompts through all orchestrators

**Tags:** orchestrator, architecture
**Scope:** packages/cli/src/orchestrators/*.ts

Adding a system prompt field to a shared interface requires updating all provider implementations to prevent silent context loss during LLM calls.
