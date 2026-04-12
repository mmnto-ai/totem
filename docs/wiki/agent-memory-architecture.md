# Agent Memory Architecture

Understanding the configuration surfaces and memory architecture for each AI agent ensures predictable behavior and prevents context drift across your workspace.

## Config Surface Map

Agents typically draw instructions and context from three levels:

1. **System/Global (`~/.`)**: Applies to all projects for the current user. Overuse here leads to cross-project bleed and bloated context windows.
2. **Project/Workspace (`./`)**: Specific to the repository. Checked into version control. This is where Totem reflexes and project rules belong.
3. **Environment (`.env` / shell)**: Where API keys and sensitive tokens must live.

## The Noise/Compliance Lesson

A core finding from extensive agent testing: **Signal-to-noise kills compliance.**
Instruction files must be kept extremely lean (ideally <32 lines). If an instruction file becomes a dump for every possible edge case, the agent's adherence to the critical rules (like "Pull Before Coding" with Totem) degrades significantly. Long files are skimmed or ignored; short files are executed as strict constraints.

## Knowledge Routing Decision Tree

When you learn something new (a rule, a trap, a preference), route it to the right layer:

| Question                                 | If yes →                                  | Examples                                                   |
| :--------------------------------------- | :---------------------------------------- | :--------------------------------------------------------- |
| Does every contributor/agent need this?  | `CLAUDE.md` / `GEMINI.md` (mirrored)      | Code style, git rules, secrets hygiene, suppression policy |
| Is it a domain trap or framework gotcha? | Totem lesson (`add_lesson`)               | Config path quirks, API edge cases, migration pitfalls     |
| Is it a GCA review rule?                 | `.gemini/styleguide.md` §6                | Declined suggestions, syntax patterns                      |
| Is it onboarding/reference material?     | `docs/wiki/`                              | Architecture guides, setup steps, decision frameworks      |
| Is it a personal agent preference?       | Agent memory (`~/.claude/`, `~/.gemini/`) | User's communication style, workflow preferences           |

**Principle:** Default to the most shared layer. If a rule only lives in one agent's memory, it's lost knowledge. New devs and other agents won't get it. Version-controlled files (`CLAUDE.md`, `GEMINI.md`, wiki) are the transferable configs.

## Secrets Hygiene

**Never inline tokens or Personal Access Tokens (PATs) in config files.**
Files like `.mcp.json`, `settings.json`, and `.claude/settings.local.json` often reside in the repository (or are easily accidentally committed). Agents and MCP servers inherit environment variables from the shell automatically. Always use a `.env` file (which should be `.gitignore`d) for your `GITHUB_TOKEN`, `OPENAI_API_KEY`, etc.
