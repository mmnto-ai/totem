## Lesson — Even when core rules are moved to a deterministic pipeline,

**Tags:** automation, llm, regressions

Even when core rules are moved to a deterministic pipeline, a single automated step using LLM-based generation can still introduce regressions in the final artifact. Manual revert steps for generated files must be retained until the entire compilation pipeline is LLM-free.
