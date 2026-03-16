---
'@mmnto/cli': minor
'@mmnto/totem': minor
'@mmnto/mcp': patch
---

feat: .mdc / .cursorrules ingestion adapter (#555)

New `totem compile --from-cursor` flag. Scans .cursor/rules/\*.mdc, .cursorrules, and .windsurfrules files. Parses frontmatter and plain text rules. Compiles them into deterministic Totem rules via the existing LLM pipeline.

docs: README Holy Grail positioning (ADR-049)

"A zero-config CLI that compiles your .cursorrules into deterministic CI guardrails. Stop repeating yourself to your AI." MCP as step 2, Solo Dev Superpower section, command table with speed metrics.
