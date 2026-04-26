## Lesson — Align tool contracts with runtime validation

**Tags:** mcp, validation, zod
**Scope:** packages/mcp/src/tools/add-lesson.ts

Ensure Zod schemas for tool inputs use `.nonempty()` if the logic requires at least one value, preventing a mismatch between the declared tool contract and actual runtime behavior.
