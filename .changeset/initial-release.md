---
'@mmnto/totem': minor
'@mmnto/cli': minor
'@mmnto/mcp': minor
---

Initial release — Phases 1-3 complete.

- Core: LanceDB vector store, 5 syntactic chunkers (TS AST, markdown, session log, schema, test), OpenAI + Ollama embedding providers, full ingest pipeline with incremental sync
- CLI: `totem init`, `totem sync`, `totem search`, `totem stats`
- MCP: `search_knowledge` and `add_lesson` tools over stdio
