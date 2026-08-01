# Claude Code

Claude Code is the primary agent for depth execution and product management. It relies on a blend of project-level files and system directories.

## 1. Config Surfaces

- **Project Context:** `CLAUDE.md`. The primary source of instructions and project rules.
- **Project Settings:** `.claude/`. Contains workspace-specific configurations (e.g., `settings.local.json`).
- **Global Settings:** `~/.claude/`. Contains global user preferences.
- **Hooks:** Git hooks or tool-specific hooks.
- **MCP Servers:** `.mcp.json`. Defines MCP server commands and environment pass-through.

## 2. Keeping Configs Lean

Due to the compliance lesson (length kills compliance), `CLAUDE.md` must only contain critical development rules and the Totem AI Integration block. Avoid turning `CLAUDE.md` into a massive styleguide. Keep it under 32 lines if possible. Focus on the most important architectural constraints.

## 3. Totem Integration

Totem injects the `search_knowledge` instruction (the "Pull Before Coding" reflex) directly into `CLAUDE.md`. Because Claude uses `.mcp.json` to discover tools, ensure Totem's MCP server is properly registered there.

## 4. Managed Skill Files

`totem init` installs Claude Code skills at `.claude/skills/<name>/SKILL.md`, and every later `totem init` refreshes them in place. Each managed file is fenced by two marker comments, `<!-- totem:skill-start -->` and `<!-- totem:skill-end -->`. The refresh contract:

- **Everything up to and including the end marker is canonical.** A refresh replaces that entire leading span — the YAML frontmatter, anything you inserted before the start marker, and the body between the markers — with the current canonical content. Edits anywhere inside it are overwritten.
- **Everything after the end marker is yours.** It is carried through verbatim on every refresh, so customizations belong below the end marker.
- **A file missing either marker (or carrying them out of order) is skipped by the refresh.** Totem preserves it untouched and warns you to move your custom content below the end marker. `totem init --force-skill-refresh` overwrites such a file with canonical content instead, discarding whatever was there.
- A refresh that would produce byte-identical content is skipped and reported as unchanged.

## 5. Common Pitfalls

- **Bloat:** Expanding `CLAUDE.md` beyond 32 lines drastically reduces adherence.
- **Secrets in `.mcp.json`:** Passing hardcoded API keys in `.mcp.json`. Always use `env` variables or shell inheritance instead.
