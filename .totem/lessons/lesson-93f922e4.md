## Lesson — Label injected metadata to prevent LLM confusion

**Tags:** llm, prompt-engineering, security
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Injected summaries or metadata can easily be mistaken by LLMs as actual file content or diffs. Wrapping these blocks in distinct XML tags with an explicit preamble prevents the model from misinterpreting metadata as code changes.
