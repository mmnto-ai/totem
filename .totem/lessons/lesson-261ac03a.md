## Lesson — LLMs can persist stale or nonexistent data when using

**Tags:** llm, documentation, prompt-engineering, hallucinations

LLMs can persist stale or nonexistent data when using previous document versions as context for regeneration cycles. Explicit negative constraints are required to prevent the model from treating its own prior output as a source of truth for issue statuses or references.
