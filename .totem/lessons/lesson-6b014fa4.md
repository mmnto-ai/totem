## Lesson — Narrow LLM output enums to prevent forgery

**Tags:** security, zod, llm
**Scope:** packages/core/src/compiler-schema.ts

Use narrow enums for LLM-facing fields to prevent the model from emitting internal-only status codes or bypassing system-level validation logic.
