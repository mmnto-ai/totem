<!-- totem-ignore-file — config paths are the subject matter -->

## Lesson — AI agent memory config architectures differ significantly

**Tags:** agent-config, init, claude, gemini, copilot, junie, architecture

AI agent memory config architectures differ significantly across agents, and GCA (the PR review bot) and Gemini CLI are separate products sharing the `.gemini/` directory with zero file overlap.

**Gemini Code Assist (GCA):** Reads only `.gemini/config.yaml` (review settings) and `.gemini/styleguide.md` (review rules). Does NOT read GEMINI.md, settings.json, hooks/, or skills/.

**Gemini CLI:** Reads `GEMINI.md` (uppercase only by default) from project root, current dir, or ancestor dirs up to git root. Also reads `.gemini/settings.json` (project-level), `~/.gemini/settings.json` (global), `.gemini/hooks/` (must be wired in settings.json), and `.gemini/skills/` (auto-discovered). Does NOT read config.yaml or styleguide.md. The context filename is configurable via `context.fileName` in settings.json.

**Claude Code:** Uses CLAUDE.md (project root) and ~/.claude/ (global). Keep CLAUDE.md lean (<~32 lines) — length kills instruction compliance.

**Copilot:** Uses `.github/copilot-instructions.md` (project only).

**Junie:** Uses `.junie/guidelines.md` (project only).

When scaffolding configs via totem init, each agent needs its own format but the instruction content should be identical and concise. IMPORTANT: `.gemini/gemini.md` (lowercase) is NOT read by either product with default settings.
