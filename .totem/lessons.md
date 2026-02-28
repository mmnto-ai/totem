# Totem Lessons

Lessons learned from PR reviews and Shield checks.
This file is version-controlled and reviewed in PR diffs.

---

## Lesson — 2026-02-28T22:42:43.291Z

**Tags:** embedding, ollama, openai, dogfood

When OpenAI embedding API returns 429, fall back to Ollama with nomic-embed-text for local development. The chunking pipeline is provider-agnostic — only the embedding step changes.
