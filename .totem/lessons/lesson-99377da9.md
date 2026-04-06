## Lesson — Strip LLM-generated markdown wrappers

**Tags:** llm, markdown, parsing
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

LLM-generated patterns often include backticks or code fences that cause silent failures in rule engines if not stripped during parsing.
