## Lesson — Rationale for additive schema changes as minor

**Tags:** versioning, api-design
**Scope:** packages/mcp/src/**/*.ts

Changing a schema to a discriminated union can be treated as a minor version if the success path is additive and the field is primarily consumed as human-readable text rather than by programmatic JSON parsers.
