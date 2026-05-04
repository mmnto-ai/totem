## Lesson — Evaluate breaking changes by consumer impact

**Tags:** versioning, api-design
**Scope:** packages/mcp/src/**/*.ts

Structural payload changes can be treated as minor if the success path is additive and the data is primarily consumed as human-rendered text rather than programmatic JSON.
