## Lesson — Leverage Anthropic prompt caching for compilers

**Tags:** llm, performance
**Scope:** packages/cli/src/commands/compile-templates.ts

Structuring large system prompts to support caching can significantly reduce costs for high-frequency LLM compiler calls within a short TTL.
