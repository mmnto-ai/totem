---
'@mmnto/totem': patch
---

Fix the Gemini provider not falling back to Ollama when the `@google/genai` SDK is missing (mmnto-ai/totem#1859). `LazyEmbedder` falls back to Ollama when the configured provider fails to **construct**, and the OpenAI provider fails at construction because `openai-embedder.ts` statically imports its SDK. `GeminiEmbedder`, by contrast, loads its SDK lazily (dynamic import inside `embed()`), so an absent `@google/genai` slipped past construction and hard-errored at embed() time — **past the fallback boundary**, asymmetric with OpenAI (a Tenet-16 crossing). `tryBuildEmbedder` now verifies the Gemini SDK resolves at construction (the explicit analog of OpenAI's top-level import), so a missing SDK triggers the documented Ollama fallback like every other provider failure. Behavior is unchanged when the SDK is present; the probe reuses the existing single-home `importGeminiSdk` and its import is cached.
