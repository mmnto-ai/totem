---
'@mmnto/mcp': patch
---

The four MCP tools (`search_knowledge`, `describe_project`, `add_lesson`, `verify_execution`) now declare `readOnlyHint`, `destructiveHint` and `openWorldHint` explicitly, so a client no longer falls back to the schema defaults that read every tool as open-world and `add_lesson` as possibly destructive. `verify_execution` is now declared not read-only: the lint it spawns writes rule metrics, telemetry, Trap Ledger events and, on a pending pack promotion, `compiled-rules.json`, all under `.totem/`. A test pins the four annotation objects through the server's advertised `tools/list`. Nothing a tool does changed (mmnto-ai/totem#3004).
