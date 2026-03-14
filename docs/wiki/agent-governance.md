# AI Agent Governance & Roles

When integrating Totem into a repository, it is critical to clearly define the boundaries, roles, and configuration files for all AI agents operating within the workspace. Without strict governance, agents may hallucinate capabilities, attempt to perform tasks outside their domain, or issue conflicting advice.

## The Primary Agents

In a standard Totem-enabled repository, there are multiple distinct AI actors. Each has a specific scope of responsibility:

### 1. Claude Code (The Builder)

- **Environment:** Local CLI / Terminal
- **Role:** Depth Execution and PM.
- **Responsibilities:** Core development loop, planning, writing code, running tests, executing database queries (via MCP), and managing git operations (commits, merges).
- **Primary Config:** `CLAUDE.md`

### 2. Gemini CLI (The Reviewer)

- **Environment:** Local CLI / Terminal
- **Role:** Breadth Analysis and Auditing.
- **Responsibilities:** High-fidelity local code reviews, cross-file structural audits, catching architectural drift, and running the `totem shield` protocol. It reports findings but does not natively commit changes or merge code.
- **Primary Config:** `.gemini/settings.json` and `GEMINI.md`

### 3. Gemini Code Assist (The GCA Bot)

- **Environment:** Headless GitHub PR integration
- **Role:** Automated PR Review.
- **Responsibilities:** Reviews pull requests in the cloud, posts comments on diffs, and flags style violations based on severity thresholds. **It cannot execute local shell commands.**
- **Primary Config:** `.gemini/config.yaml` and `.gemini/styleguide.md`

---

## Configuration File Matrix

The `.gemini/` directory can be a source of confusion because it houses configurations for both the local Gemini CLI and the headless GCA bot.

| File                        | Read By                            | Purpose                                                                                                                                                              |
| :-------------------------- | :--------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`CLAUDE.md`**             | Claude Code                        | Project context, architectural rules, and Totem local reflexes.                                                                                                      |
| **`.gemini/settings.json`** | Gemini CLI                         | CLI tool configuration, UI preferences, and model defaults.                                                                                                          |
| **`.gemini/config.yaml`**   | GCA Bot                            | PR review settings (severity thresholds, file exclusions, max comments).                                                                                             |
| **`.gemini/styleguide.md`** | GCA Bot & Gemini CLI *[needs verification]* | Syntactic rules, formatting, and coding standards.                                                                                                                   |

---

## Workflow Scoping (The Overlap Problem)

Because `totem init` injects local terminal reflexes (like running `totem sync` or `totem shield`) into shared context or if developers accidentally place CLI instructions into GCA's `.gemini/styleguide.md`, there is a risk that the headless GCA bot will read these instructions and hallucinate CLI capabilities during a PR review.

**The Solution:**
All instructions injected into shared context files must include explicit environmental scoping. For example:

> `[FOR LOCAL CLI/TERMINAL AGENTS ONLY] Do not attempt to run these commands if you are a headless bot or operating in a cloud PR environment.`

This ensures that while the local Gemini CLI knows how to orchestrate Totem, the GCA bot ignores those instructions and sticks strictly to PR commentary.
