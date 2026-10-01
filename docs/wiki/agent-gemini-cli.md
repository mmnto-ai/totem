# Gemini CLI

The Gemini CLI is a terminal agent for breadth analysis, code review, and cross-file structural edits.

## 1. Config Surfaces

- **Project Context:** `GEMINI.md`. The main instruction file in the repository root.
- **Project Settings:** `.gemini/settings.json`. Local configuration for UI, defaults, and model choices.
- **Global Context:** `~/.gemini/`. Global configuration and instructions. **Warning:** Watch out for `~/.gemini/GEMINI.md` accumulating cross-project bleed and duplicates.
- **Hooks:** `.gemini/hooks/`, registered via `settings.json` entries (entries must match the current CLI hook schema — an invalid entry is silently discarded at boot, see [mmnto-ai/totem#2558](https://github.com/mmnto-ai/totem/issues/2558)).
- **Skills:** Gemini CLI ≥0.53 loads **directory-form** skills — `<name>/SKILL.md` with `name` + `description` frontmatter — from both `.gemini/skills/` and the vendor-neutral `.agents/skills/` (trust-gated: untrusted folders load no workspace skills). Flat `*.md` files load from **neither** directory, so this repo's flat `.gemini/skills/{totem,signoff}.md` are dead weight (probe-verified 2026-08-03, both forms). Cohort standard is `.agents/skills/` — one surface serves gemini/agy/kimi ([mmnto-ai/totem#2532](https://github.com/mmnto-ai/totem/issues/2532)).

## 2. Keeping Configs Lean

Gemini CLI reads `GEMINI.md` on startup. Like Claude Code, keep this file under 32 lines. Do not use the global `~/.gemini/GEMINI.md` as a dump for every instruction, as those lines will pollute the context window of every project you open.

## 3. Totem Integration

The `AI_PROMPT_BLOCK` provided by `totem init` is injected into `GEMINI.md`. This ensures Gemini CLI runs the `search_knowledge` MCP tool before making edits. The CLI can also execute `totem review` and hooks to re-index the memory db.

**Workspace trust and the MCP tools.** Gemini CLI filters MCP servers in a workspace folder the user has not trusted, so a Gemini session in an untrusted folder can start without the Totem MCP tools (`search_knowledge`, `add_lesson`). `totem doctor` reports the trust state in its `Gemini Workspace Trust` row, as read from Gemini CLI's trust file (`~/.gemini/trustedFolders.json`), when this repository's `.gemini/settings.json` declares an MCP server. Until the folder is trusted, the CLI fallback is `totem search "<query>"` (and `totem lesson add "<text>"` in place of `add_lesson`); the managed reflex block tells the agent the same. The trust file's shape was measured on Gemini CLI 0.61.0 only, so on a file the row does not recognise it reports `skip` rather than a guess ([mmnto-ai/totem#2933](https://github.com/mmnto-ai/totem/issues/2933)).

## 4. Common Pitfalls

- **The Global Trap:** `~/.gemini/GEMINI.md` grows to 64+ lines of duplicate instructions and bloats the context window for every project.
- **Dead Files:** A lowercase-named instruction file placed inside `.gemini/` is dead or unrecognized by both Gemini CLI and GCA. The correct filename is `GEMINI.md` at the project root.
- **Secrets Leakage:** Hardcoding PATs inside `.gemini/settings.json`.
