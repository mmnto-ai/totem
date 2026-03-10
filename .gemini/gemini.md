## CRITICAL SAFETY RULES (read first, always)

These rules override all other instructions. Violating them causes real damage.

1. **NEVER commit or push directly to `main` or `master`.** Always create a feature branch and open a Pull Request. No exceptions.
2. **NEVER execute without explicit user instruction.** Do not stage, commit, create branches, push, or execute file migrations unless the user tells you to. Discussing, answering questions about, or planning a change does NOT mean "execute it."
3. **NEVER merge pull requests.** Merging requires explicit user approval, every time. CI passing does NOT equal approval.
4. **NEVER run destructive git commands** (`git reset --hard`, `git checkout --`, `git clean`, `git push --force`) without explicit user instruction. If you made a mistake, tell the user and let them decide how to fix it.
5. **NEVER amend commits on feature branches.** Create new commits for each fix round.

## STOP AND ASK (these always need user confirmation)

Before taking ANY of these actions, state what you plan to do and wait for explicit approval:

- Creating or switching branches
- Staging or committing files
- Pushing to any remote
- Creating, closing, or commenting on issues/PRs
- Running any git command that modifies history
- Deleting files, branches, or any persistent state
- Running migrations or data-modifying scripts

## Memory Decision Tree

When deciding where to store information or rules:

- Will forgetting this cause a mistake on an UNRELATED task? → MEMORY.md
- Stable, project-wide workflow rule? → CLAUDE.md
- Stable syntax or architectural rule? → .gemini/styleguide.md
- Specific domain knowledge or a past trap? → Totem lesson via `add_lesson`

## Totem AI Integration (Auto-Generated)

You have access to the Totem MCP for long-term project memory. You MUST operate with the following reflexes:

### Memory Reflexes

1. **Pull Before Planning:** Before writing specs, architecture, or fixing complex bugs, use `search_knowledge` to retrieve domain constraints and past traps.
2. **Proactive Anchoring (The 3 Triggers):** You must autonomously call `add_lesson` when any of the following occur — do NOT wait for the user to ask:
   - **The Trap Trigger:** If you spend >2 turns fixing a bug caused by a framework quirk, unexpected API response, or edge case. (Anchor the symptom + fix).
   - **The Pivot Trigger:** If the user introduces a new architectural pattern or deprecates an old one. (Anchor the rule).
   - **The Handoff Trigger:** At the end of a session or when wrapping up a complex feature, extract the non-obvious lessons learned and anchor them.
3. **Tool Preference (MCP over CLI):** Always prioritize using dedicated MCP tools (e.g., GitHub, Supabase, Vercel) over executing generic shell commands (like `gh issue view` or `curl`). MCP tools provide structured, un-truncated data optimized for your context window. Only fall back to bash execution if an MCP tool is unavailable or fails.

Lessons are automatically re-indexed in the background after each `add_lesson` call — no manual sync needed.

### Workflow Orchestrator Rituals

Totem provides CLI commands that map to your development lifecycle. Use them at these moments:

1. **Start of Session:** Run `totem briefing` to get oriented with current branch state, open PRs, and recent context. Run `totem triage` if you need to pick a new task.
2. **Before Implementation:** Run `totem spec <issue-url-or-topic>` to generate an architectural plan and review related context before writing code.
3. **Before PR/Push:** Run `totem shield` to analyze uncommitted changes against project knowledge — catches architectural drift and pattern violations.
4. **End of Session:** Run `totem handoff` to generate a snapshot for the next agent session with current progress and open threads.
