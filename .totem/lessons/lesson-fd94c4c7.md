## Lesson — Mermaid node labels cannot contain // — GitHub lexer treats

**Tags:** mermaid, github, documentation, rendering, trap

# Mermaid node labels cannot contain // — GitHub lexer treats it as comment syntax

## What happened
The architecture diagram at `docs/reference/architecture-diagram.md` failed to render on GitHub with "Lexical error on line 9. Unrecognized text." The node label `[// totem-context:<br/>or --override]` confused the mermaid parser because `//` is interpreted as comment syntax.

## Rule
When writing mermaid diagram node labels, avoid `//` characters. Use plain text descriptions instead of code syntax. If you must include special characters, wrap the label in double quotes: `["label text"]`.

**Example Hit:** `Override[// totem-context:<br/>or --override]:::action` — lexer error
**Example Miss:** `Override["totem-context directive<br/>or --override flag"]:::action` — renders correctly

**Source:** mcp (added at 2026-03-27T22:17:26.403Z)
