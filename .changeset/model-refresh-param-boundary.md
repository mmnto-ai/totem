---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

feat(orchestrators): current-generation model support — sampling params reconciled at the provider boundary (mmnto-ai/totem#1476).

Current-generation models reject client sampling params with a 400 (Anthropic Opus 4.7+/Sonnet 5+/Fable reject `temperature`/`top_p`/`top_k`; OpenAI gpt-5+/o-series additionally reject the legacy `max_tokens` key in favor of `max_completion_tokens`). Previously every Totem LLM role hardcoded a `temperature`, so pointing any override or review lane at a current-generation model failed at runtime — GPT-5-family models could not be used as orchestrators at all.

`modelStripsTemperature()` (`@mmnto/totem`) widens from the Opus-4.7+-only regex to the cross-provider predicate (Sonnet 5+, Haiku 5+, Fable/Mythos, gpt-5+, o-series; provider-qualified strings accepted), and both the anthropic and openai orchestrator boundaries now consume it: callers keep declaring their intended temperature, and the boundary omits it for models that reject it. The openai orchestrator additionally selects `max_completion_tokens` vs legacy `max_tokens` on the same predicate, so OpenAI-compatible local servers (Ollama, LM Studio, Groq) keep the legacy shape they expect.

Consumer-impact: orchestrator request shape — configs pointing at Opus 4.7+/Sonnet 5+/Fable or gpt-5+/o-series models now work instead of failing with a 400; requests to models that accept sampling params are byte-identical. `modelStripsTemperature` returns `true` for the new families, which also flows into the compile-worker fingerprint (records temperature absence) for anthropic-provider configs. No config migration required.
