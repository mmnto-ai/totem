## Lesson — Relying solely on system prompts to exclude internal data

**Tags:** llm, documentation, sanitization

Relying solely on system prompts to exclude internal data like issue references is insufficient for reliable output sanitization. Implementing a programmatic post-processing step provides a deterministic safety net against LLM hallucinations or prompt leaks in public-facing documentation.
