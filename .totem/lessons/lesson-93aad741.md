## Lesson — README and curated wiki pages must never be LLM-generated

**Tags:** documentation, readme, totem-docs, deterministic, strategy

# README and curated wiki pages must never be LLM-generated

## What happened
The `totem docs` command was configured to regenerate README.md. The LLM output consistently failed to match the handcrafted "NASA-by-Google" marketing tone, introduced stale pinned content, and weakened the sales pitch. The README was removed from the `docs` array in totem.config.ts to protect it.

## Rule
Protected documents (README.md, workflow wiki pages, COVENANT.md, CHANGELOG.md) must be handcrafted and explicitly excluded from `totem docs` LLM generation. Only forward-looking tracker documents (roadmap.md, active_work.md) should be LLM-maintained. Use `docs:inject` (deterministic) for values like rule counts and CLI tables.

**Source:** mcp (added at 2026-03-27T21:24:30.029Z)
