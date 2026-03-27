# Governing AI Agents

AI coding agents (Claude, Gemini, Cursor) are brilliant at solving the 100 lines of code directly in front of them. However, they suffer from **Systemic Amnesia**.

When starting a new session, they forget the broader context of the project. They reinvent shared helpers, ignore recent architectural decisions, and bypass critical operational steps (like recompiling assets).

If you want agents to write production-grade code, you cannot rely on static documentation (`CLAUDE.md` or `GEMINI.md`). **Documentation is a suggestion; agents need physical constraints.**

Totem provides the **Governance Operating System** to lock down AI agents.

## 1. The Smart Briefing (Turn-1 Hydration)

Instead of hoping an agent reads a static README, Totem _injects_ reality into the agent's brain the moment it wakes up.

By wiring the `totem briefing` command into your agent's startup hooks (e.g., `.gemini/hooks/SessionStart.js`), the agent is forced to process the live state of the project before it takes any action:

```text
[Briefing] @mmnto/cli@1.5.7 | main | 2 uncommitted | lint: 0 errors | shield: PASS
[Briefing] Manifest: STALE (lessons changed since last compile)
[Briefing] Status: compile required before push
[Reflex] Compile after extract — CI gate rejects stale manifests
[Reflex] Hook regex was too broad — tightened in #1021, watch for regressions
```

**The Impact:** The agent immediately knows it needs to run `totem compile` before pushing, and it has the "Tactical Reflexes" (recent lessons learned) fresh in its context window.

## 2. Deterministic Guardrails (The Exoskeleton)

You cannot trust an AI agent to self-police its own code. You must build an environment where the "wrong" way physically fails.

Using Totem's Pipeline 1 rules, you can encode architectural mandates that act as invisible boundaries:

- _"Direct use of `child_process` is forbidden. Use `safeExec`."_
- _"Never use empty catch blocks in the `core/` package."_

When the agent attempts to commit code that violates these rules, the `totem lint` pre-push hook instantly fails, kicking the agent back into a refactor loop. The agent learns the architecture through failure, not reading.

## 3. Protocol-in-Description (MCP Hardening)

If you expose Model Context Protocol (MCP) tools to your agents, they will often call them out of order.

Totem governs this by embedding the constraint directly into the tool's description string—the one place the LLM always looks.

- Instead of: `"Adds a lesson to the index."`
- Totem uses: `"CRITICAL: Call search_knowledge first to check for duplicates. Adds a lesson to the index."`

## The Result

By combining Smart Briefings with Deterministic Guardrails, your agents stop acting like "fast-but-messy juniors" and start acting like "fast-and-compliant seniors." You stop managing their output and start managing their environment.
