## Lesson — Lesson — Shield prompt override must preserve verdict format

**Tags:** shield, prompt, trap, verdict

## Lesson — Shield prompt override must preserve verdict format

**Tags:** shield, prompt, trap

When overriding the shield system prompt via `.totem/prompts/shield.md`, the custom prompt can displace the built-in verdict format instruction. If the LLM doesn't emit `### Verdict\nPASS/FAIL` as the first line, the verdict parser returns null and shield defaults to FAIL. Always include explicit verdict format instructions in custom shield prompts. The regex (`VERDICT_RE`) is anchored to the start of the output — no `/m` flag.

**Source:** mcp (added at 2026-03-24T18:46:47.392Z)
