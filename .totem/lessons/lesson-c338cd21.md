## Lesson — README.md should be excluded from deterministic lint — it's

**Tags:** readme, lint, ignorePatterns, documentation, false-positive

# README.md should be excluded from deterministic lint — it's marketing copy

## What happened
The README was rewritten as a "Storefront" with mermaid diagrams. Deterministic lint rules designed for source code (issue number patterns, import checks) false-positived on diagram syntax, CSS hex colors, and example code blocks.

## Rule
Marketing-facing documentation (`README.md`) should be in `ignorePatterns` for `totem lint`. It contains:
- Mermaid diagrams with CSS-like syntax
- Example code blocks showing deliberate "wrong" patterns
- Shell output examples with `#` comments

These will always conflict with rules designed for source code. Shield (LLM) can still review it meaningfully; lint (regex) cannot.

**Source:** mcp (added at 2026-03-27T19:56:00.512Z)
