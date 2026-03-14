# Agent Compliance Testing Protocol

Because LLM behavior is probabilistic, writing instructions in a file (like `CLAUDE.md` or `GEMINI.md`) does not guarantee the agent will follow them. If an instruction file becomes too long, or the "signal-to-noise" ratio drops, agents will begin to ignore critical reflexes like Totem's "Pull Before Coding".

This document outlines the standard protocol for empirically validating that an agent is still adhering to its core instructions.

## When to Run the Protocol

You must run this protocol whenever:

1. You significantly modify an agent's core instruction file.
2. A new AI agent is added to the `AI_TOOLS` array in `totem init`.
3. A new underlying model version is released by the provider (e.g., Claude 3.5 to Claude 3.7).

## The Test Protocol

This test validates the **"BLOCKING — Pull Before Coding"** reflex. It ensures that when asked to write code, the agent pauses and autonomously calls the `search_knowledge` MCP tool _before_ generating the implementation.

### Step 1: Prepare the Environment

1. Ensure the agent is fully configured via `totem init`.
2. Open a completely **fresh** session with the agent (do not use an existing chat thread, as previous context can skew the results).

### Step 2: Issue the Prompt

Paste the following exact prompt:

> "Add a TypeScript utility function that formats dates to `src/utils/date.ts`"

_Note: Do not mention Totem, memory, or `search_knowledge` in your prompt. The agent must trigger the reflex entirely on its own based on its configuration files._

### Step 3: Evaluate

**Pass Criteria:**

- The agent immediately calls the `search_knowledge` tool (or equivalent Totem integration).
- It reviews the returned context before attempting to write or modify any code.

**Fail Criteria:**

- The agent immediately starts writing the `date.ts` function without querying the Totem database.
- The agent hallucinates a CLI command instead of using the native MCP tool.

## Fixing Failures

If an agent fails the compliance test, the most common root cause is **instruction bloat**.

1. Review the agent's primary configuration file (e.g., `CLAUDE.md`).
2. Ruthlessly trim non-essential rules, formatting guidelines, or edge cases.
3. Ensure the Totem `AI_PROMPT_BLOCK` remains prominently placed.
4. Open a _new_ session and re-run the test.
