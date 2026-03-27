## Lesson — HTML comment totem-context directives are not parsed by lint

**Tags:** totem-context, lint, suppression, markdown, trap

# HTML comment totem-context directives are not parsed by lint

## What happened
Added `<!-- totem-context: mermaid diagram — hex colors are not issue numbers -->` to README.md expecting it to suppress lint false positives. Lint still flagged the hex colors because lint looks for `// totem-context:` in code-style comments, not HTML comments.

## Rule
- `// totem-context: <reason>` → suppresses lint AND shield (same-line or preceding-line in code files)
- `// totem-ignore` → suppresses lint only (no justification logged)
- `ignorePatterns` in config → file-level exclusion from lint

In markdown files, `// totem-context:` syntax doesn't work because markdown has no line-comment syntax. Use `ignorePatterns` to exclude markdown files from lint instead.

**Source:** mcp (added at 2026-03-27T19:55:50.111Z)
