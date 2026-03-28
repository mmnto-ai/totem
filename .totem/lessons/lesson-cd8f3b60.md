## Lesson — Lesson — LLM compilation should be the last resort, not

**Tags:** compiler, architecture, stress-test, llm-reliability, rule-generation

## Lesson — LLM compilation should be the last resort, not the primary mechanism for rule generation

**Tags:** compiler, architecture, stress-test

When generating enforcement rules from lessons, prefer deterministic methods over LLM generation. The priority stack should be: (1) Programmatic AST extraction from code examples — parse the example with Tree-sitter and mechanically derive the pattern, zero LLM required. (2) Template classification — the LLM classifies intent against a library of known pattern templates and fills parameters, reducing its job from syntax generation to classification. (3) LLM free-form generation — only when no code example or matching template exists. (4) Explicit failure with reasoning — if all paths fail, tell the user why. During the 1.6.0 stress test, the LLM compiler produced 0/6 usable rules from well-written lessons on a clean external repo, while the deterministic enforcement engine (totem lint) was rock solid. Classification is what LLMs excel at; syntax generation is where they hallucinate.

**Source:** mcp (added at 2026-03-28T17:12:19.312Z)
