---
'@mmnto/mcp': patch
---

The four MCP tools (`search_knowledge`, `describe_project`, `add_lesson`, `verify_execution`) now declare `readOnlyHint`, `destructiveHint` and `openWorldHint` explicitly, judged over the project's git-tracked content, so a client no longer falls back to the schema defaults that read every tool as open-world and `add_lesson` as possibly destructive. `verify_execution` is now declared not read-only and destructive: on a pending pack promotion the lint it spawns rewrites the tracked `compiled-rules.json` in place and writes `verification-outcomes.json`, and on every run that evaluates rules it writes rule metrics, telemetry and, on a suppression, a Trap Ledger event under ignored `.totem/` paths. The rich-state `git status` read in `describe_project` no longer takes git's optional index lock. A test pins the four annotation objects through the server's advertised `tools/list`; the README states the rule and discloses each tool's writes (mmnto-ai/totem#3004).
