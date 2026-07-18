## Lesson — Advance RegExp lastIndex past nested blocks

**Tags:** regex, javascript, parsing
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

When iteratively parsing nested blocks using a global RegExp, failing to advance `lastIndex` past the extracted block can cause the scanner to resume inside the block content, leading to duplicate extractions or incorrect attribution.
