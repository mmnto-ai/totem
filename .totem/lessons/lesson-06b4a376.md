## Lesson — MCP tool hints are declared over git-tracked content, all three explicitly

**Tags:** mcp, api-design, annotations
**Scope:** packages/mcp/**/*.ts, !**/*.test.*, !**/*.spec.*

Each of the four MCP tools declares `readOnlyHint`, `destructiveHint` and `openWorldHint` explicitly instead of leaving any of them to a client's default. The hints are judged against git-tracked content only: a tool that writes ignored local state (an audit log, a cache, rule metrics) still declares read-only, which is why `totem init` now writes the local-state ignore lines. So `search_knowledge` and `describe_project` are read-only; `add_lesson` is not read-only and not destructive (it adds a lesson file); `verify_execution` is not read-only and is destructive, because a pending pack promotion makes the spawned lint rewrite the tracked compiled rules in place. Each declaration carries a comment naming the write that decides it (mmnto-ai/totem#3013).
