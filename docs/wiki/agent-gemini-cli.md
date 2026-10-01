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

**Workspace trust and the MCP tools.** Gemini CLI suppresses MCP servers (project-level, user-level and extension) in a workspace folder it does not trust, so a Gemini session in an untrusted folder can start without the Totem MCP tools (`search_knowledge`, `add_lesson`). The row reads the directory `totem doctor` runs in, as Gemini CLI reads its workspace settings from its working directory: when that directory's `.gemini/settings.json` declares a project-level MCP server, `totem doctor` reports the trust state in its `Gemini Workspace Trust` row, as read from Gemini CLI's trust file (`~/.gemini/trustedFolders.json`) under Gemini CLI's own longest-matching-key rule. To change the trust level, run `/permissions` in Gemini CLI (an unlisted folder also prompts on an interactive start). Until the folder is trusted, the CLI fallback is `totem search "<query>"` (and `totem lesson add "<text>"` in place of `add_lesson`). In an untrusted folder Gemini CLI loads neither the MCP servers nor the project `GEMINI.md`, so the managed reflex block is not read there: the `Gemini Workspace Trust` row of `totem doctor`, run from a terminal, is the signal for this case, and the reflex block's item for absent Totem tools serves the other cases where the tools are missing. The rule is read from Gemini CLI 0.61.0's source, and the row does not read `GEMINI_RESTRICTED_MODE`, `GEMINI_CLI_TRUST_WORKSPACE`, the `security.folderTrust.enabled` setting or IDE workspace trust. On Windows the row declines when this folder's path or any trust-file key contains `~` (a short name, which Gemini CLI resolves natively and the row does not), so one trust-file key containing `~` makes this row decline for every folder on that machine. On anything it does not recognise it reports `skip` rather than a guess ([mmnto-ai/totem#2933](https://github.com/mmnto-ai/totem/issues/2933)).

## 4. Common Pitfalls

- **The Global Trap:** `~/.gemini/GEMINI.md` grows to 64+ lines of duplicate instructions and bloats the context window for every project.
- **Dead Files:** A lowercase-named instruction file placed inside `.gemini/` is dead or unrecognized by both Gemini CLI and GCA. The correct filename is `GEMINI.md` at the project root.
- **Secrets Leakage:** Hardcoding PATs inside `.gemini/settings.json`.
