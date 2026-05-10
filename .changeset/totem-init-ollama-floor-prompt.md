---
'@mmnto/totem': minor
---

`totem init` now probes the local Ollama daemon (`http://localhost:11434/api/tags`)
during fresh project setup and emits a one-line floor-expectation message before the
embedding-tier branch runs. When detected, the message reports the daemon URL; when
absent, it includes the install hint (`https://ollama.com`). Skipped in `--bare`
mode (no embedder configured) and on re-runs over an existing config (the floor was
surfaced at first init).

Closes the consumer-side discoverability gap that motivated the `LazyEmbedder`
fallback chain in `mmnto-ai/totem#522`: cloud-key auto-detection silently picked
Gemini/OpenAI without ever telling the user Ollama is the recommended local floor,
so when the cloud provider failed at `totem sync` time, consumers reached for
`pnpm add @google/genai` (a Tenet 16 vendor-coupling workaround that propagated
across `mmnto-ai/totem-strategy`, `mmnto-ai/totem-status`, and `mmnto-ai/liquid-city`)
instead of the documented Ollama install.

New public helper: `probeOllamaFloor()` exported from `@mmnto/cli`'s init module —
returns `{ available, baseUrl, message }`, never throws, uses the same 3-second
`AbortSignal` timeout as `LazyEmbedder` and `totem doctor`. Mirrors the
`checkOllama` doctor diagnostic shipped in PR-1 (`mmnto-ai/totem#1860`).

Closes `mmnto-ai/totem#1851` (PR-2 of 2 — completes the original two-surface ask;
PR-1 covered the `totem doctor` half plus the empirical regression test that locks
the `LazyEmbedder` `TotemConfigError` fallback contract).
