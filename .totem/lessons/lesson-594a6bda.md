## Lesson — Gemini CLI requires directory form skills

**Tags:** gemini, cli, discovery
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Gemini CLI scans both `.gemini/skills` and `.agents/skills` using a nested glob pattern, meaning it only discovers directory-form `*/SKILL.md` files and ignores flat `*.md` files.
