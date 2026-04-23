## Lesson — Validate mutually exclusive LLM output fields

**Tags:** zod, validation, llm
**Scope:** packages/core/src/compiler-schema.ts

Use Zod `superRefine` to enforce mutual exclusivity between success flags and error metadata, preventing ambiguous model responses that pair patterns with reason codes.
