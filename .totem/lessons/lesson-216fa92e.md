## Lesson — A shared reflex block cannot send cloud bots to a terminal

**Tags:** init, reflex-block, mcp, cloud-bots
**Scope:** packages/cli/src/commands/init-templates.ts

The managed reflex block (`AI_PROMPT_BLOCK`) is one text injected into every agent instruction file, including the one a cloud PR bot reads, and that file's own Cloud / PR Review Bots section says those bots have no local CLI. An item that tells the agent to fall back to terminal commands therefore has to scope itself: "If you have a terminal, use it instead … A cloud bot with no local CLI stops at telling the user." The first wording told every reader to use the terminal; a review bot caught it, and the drift test now pins both sentences (mmnto-ai/totem#2999).
