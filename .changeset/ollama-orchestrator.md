---
'@mmnto/cli': minor
'@mmnto/totem': minor
---

Add native Ollama orchestrator provider with dynamic `num_ctx` support

- New `provider: 'ollama'` orchestrator config hits Ollama's native `/api/chat` endpoint directly via fetch (no SDK required)
- Supports `numCtx` option to dynamically control context length and VRAM usage per-command
- VRAM-friendly error messages on 500 errors suggest lowering `numCtx`
- Connection errors suggest running `ollama serve`
- Mirrors the existing `ollama-embedder` pattern (plain fetch, baseUrl defaulting)
