---
'@mmnto/cli': patch
---

`totem doctor`'s Secret Scan no longer reads an English hyphenation that ends in `sk-` as a leaked key. The two OpenAI-shaped patterns (`sk-…`, `sk-ant-…`) now require the token to start at `sk-`: a letter before it makes it the tail of a word, so `ask-the-registered-lead-first…`, `task-…`, `risk-…` and `desk-…` runs of twenty or more word characters pass, while a key after a quote, a bracket, an equals sign, an underscore or a digit is still caught. The scan runs over `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules` and `.totem/lessons/*.md`, and on the strict tier the pre-push hook runs it through `totem doctor --strict`, so a lessons corpus written in English no longer refuses its own push (mmnto-ai/totem#3131).
