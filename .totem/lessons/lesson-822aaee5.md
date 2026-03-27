## Lesson — Regex lint rules must exclude fenced code blocks

**Tags:** lint, regex, markdown, false-positive, code-blocks

# Regex lint rules must exclude fenced code blocks in markdown files

## What happened
The "issue number" rule (`/#\d+/`) matched hex color codes like `#4b3a75` inside mermaid diagram code blocks in `README.md`, producing 4 false positive errors that blocked push.

## Root cause
Regex-based lint rules run line-by-line without awareness of fenced code block context. Any pattern that matches common code syntax (hex colors, CSS selectors, shell comments) will false-positive inside markdown code blocks.

## Rule
When writing regex lint rules that could match inside code examples, either:
1. Scope the rule to exclude `*.md` files
2. Add the file to `ignorePatterns` if it's a marketing/docs file
3. Consider adding fenced-block awareness to the lint engine

`// totem-context:` suppresses both lint and shield in code files, but markdown has no line-comment syntax so it cannot be used there. Use `ignorePatterns` for markdown exclusions.

**Example Hit:** `classDef observe fill:#4b3a75,stroke:#9b72cf` — hex colors match `#\d+`
**Example Miss:** `Closes #1026` — actual issue reference, should match

**Source:** mcp (added at 2026-03-27T19:55:45.579Z)
