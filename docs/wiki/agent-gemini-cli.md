# Gemini CLI

The Gemini CLI is a terminal agent for breadth analysis, code review, and cross-file structural edits.

## 1. Config Surfaces

- **Project Context:** `GEMINI.md`. The main instruction file in the repository root.
- **Project Settings:** `.gemini/settings.json`. Local configuration for UI, defaults, and model choices.
- **Global Context:** `~/.gemini/`. Global configuration and instructions. **Warning:** Watch out for `~/.gemini/GEMINI.md` accumulating cross-project bleed and duplicates.
- **Hooks:** `.gemini/hooks/`, registered via `settings.json` entries (entries must match the current CLI hook schema — an invalid entry is silently discarded at boot, see [mmnto-ai/totem#2558](https://github.com/mmnto-ai/totem/issues/2558)).
- **Skills:** the vendor-neutral `.agents/skills/<name>/SKILL.md` surface ([mmnto-ai/totem#2532](https://github.com/mmnto-ai/totem/issues/2532)). Gemini CLI ≥0.53 does **not** load `.gemini/skills/*.md` — files there are legacy artifacts (probe-verified 2026-08-03).

## 2. Keeping Configs Lean

Gemini CLI reads `GEMINI.md` on startup. Like Claude Code, keep this file under 32 lines. Do not use the global `~/.gemini/GEMINI.md` as a dump for every instruction, as those lines will pollute the context window of every project you open.

## 3. Totem Integration

The `AI_PROMPT_BLOCK` provided by `totem init` is injected into `GEMINI.md`. This ensures Gemini CLI runs the `search_knowledge` MCP tool before making edits. The CLI can also execute `totem review` and hooks to re-index the memory db.

## 4. Common Pitfalls

- **The Global Trap:** `~/.gemini/GEMINI.md` grows to 64+ lines of duplicate instructions and bloats the context window for every project.
- **Dead Files:** A lowercase-named instruction file placed inside `.gemini/` is dead or unrecognized by both Gemini CLI and GCA. The correct filename is `GEMINI.md` at the project root.
- **Secrets Leakage:** Hardcoding PATs inside `.gemini/settings.json`.
