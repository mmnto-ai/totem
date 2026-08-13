## Lesson — Strictly match bot login suffixes

**Tags:** github, security, regex
**Scope:** packages/cli/src/parsers/bot-review-parser.ts

When normalizing Greptile and GHCQ bot accounts, require the explicit `[bot]` login suffix to prevent human accounts with similar names from being classified as bots. Preserve the established matching rules for CodeRabbit and Gemini Code Assist.
