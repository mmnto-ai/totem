# Gemini CLI

The Gemini CLI is a powerful terminal agent designed for breadth analysis, code review, and cross-file structural edits.

## 1. Config Surfaces

- **Project Context:** `GEMINI.md` — The main instruction file in the repository root.
- **Project Settings:** `.gemini/settings.json` — Local configuration for UI, defaults, and model choices.
- **Global Context:** `~/.gemini/` — Global configuration and instructions. **Warning:** Watch out for `~/.gemini/GEMINI.md` accumulating cross-project bleed and duplicates.
- **Hooks & Skills:** `.gemini/hooks/` and `.gemini/skills/` — Project-specific reflexes and automated behaviors.

## 2. Keeping Configs Lean

Gemini CLI reads `GEMINI.md` on startup. Like Claude Code, keep this file under 32 lines. Do not use the global `~/.gemini/GEMINI.md` as a dump for every instruction, as those lines will pollute the context window of every project you open.

## 3. Totem Integration

The `AI_PROMPT_BLOCK` provided by `totem init` is injected into `GEMINI.md`. This ensures Gemini CLI runs the `search_knowledge` MCP tool before making edits. The CLI can also execute `totem review` and hooks to re-index the memory db.

## 4. Common Pitfalls

- **The Global Trap:** `~/.gemini/GEMINI.md` growing to 64+ lines of duplicate instructions, causing massive context bloat.
- **Dead Files:** Using `.gemini/gemini.md` (lowercase) — this file is dead/unrecognized by both Gemini CLI and GCA. The correct filename is `GEMINI.md` at the project root.
- **Secrets Leakage:** Hardcoding PATs inside `.gemini/settings.json`.
