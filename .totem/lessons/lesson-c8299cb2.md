## Lesson — Guard against token prefix collisions

**Tags:** regex, parsing, security
**Scope:** packages/core/src/parity-detect.ts

Using word boundaries (`\b`) to match custom comment markers can cause prefix collisions with longer sibling tokens (e.g., matching `agent-bus` inside `agent-bus-v2`). Instead, use a lookahead for whitespace or the closing tag delimiter to ensure exact matches.
