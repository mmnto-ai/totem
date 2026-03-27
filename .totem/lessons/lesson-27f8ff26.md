## Lesson — The totem-context directive only works for shield, not lint

**Tags:** totem-context, shield, lint, suppression, trap

# The totem-context directive only works for shield, not lint

## What happened
Added `<!-- totem-context: mermaid diagram — hex colors are not issue numbers -->` to README.md expecting it to suppress lint false positives. Lint still flagged the hex colors because `totem-context` is processed by the LLM-based shield reviewer, not the deterministic regex lint engine.

## Rule
- `totem-context:` → LLM context for **shield** (provides explanation to the AI reviewer)
- `// totem-ignore` → inline suppression for **lint** (skips the line for regex matching)
- `ignorePatterns` in config → file-level exclusion for **lint**

These are three different suppression mechanisms for different enforcement layers. Don't confuse them.

**Source:** mcp (added at 2026-03-27T19:55:50.111Z)
