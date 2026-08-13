## Lesson — Strictly match bot login suffixes

**Tags:** github, security, regex
**Scope:** packages/cli/src/parsers/bot-review-parser.ts

When normalizing bot accounts as review surfaces, require explicit suffixes like `[bot]` to prevent human accounts with similar names from being incorrectly classified as bots.
