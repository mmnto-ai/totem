---
'@mmnto/cli': patch
'@mmnto/totem': patch
'@mmnto/mcp': patch
---

Incremental shield, totem status/check, docs staleness fix.

- feat: incremental shield validation — delta-only re-check for small fixes (#1010)
- feat: totem status + totem check commands (#951)
- fix: totem docs staleness — aggressive rewrite of stale roadmap sections (#1024)
- fix: mermaid lexer error in architecture diagram
- chore: MCP add_lesson rate limit bumped to 25 per session
- chore: 364 compiled rules, 966 lessons, 2,000 tests
