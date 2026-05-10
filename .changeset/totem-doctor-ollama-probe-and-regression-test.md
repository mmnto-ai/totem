---
'@mmnto/totem': minor
---

`totem doctor` now probes the Ollama daemon (`http://localhost:11434/api/tags`) and
surfaces the floor-embedder expectation as a new `Ollama` diagnostic. When the daemon
is unreachable the check returns `warn` with a remediation pointing at
`https://ollama.com` and `ollama pull nomic-embed-text`; when reachable it returns
`pass` and reports the URL. Honors a custom `embedding.baseUrl` from `totem.config.ts`
when `provider: 'ollama'` is configured.

New public API: `isOllamaAvailable(baseUrl?)` exported from `@mmnto/totem`. The
function is the same probe `LazyEmbedder` uses internally — bounded by a 3-second
`AbortSignal` timeout, never throws, returns `false` on any network failure.

Locks the `LazyEmbedder` `TotemConfigError` fallback contract via regression tests:
when the configured provider fails to construct (typically missing API key) AND
Ollama is unreachable, callers receive `code: 'CONFIG_MISSING'`, message containing
"No embedding provider available", and a recovery hint with the documented 3-step
remediation. Prevents future refactors from silently regressing the contract that
keeps consumers off vendor-coupling workarounds (Tenet 16).

Closes #1851 (PR-1 of 2; the `totem init` Ollama prompt is PR-2). Sibling
follow-up `#1859` tracks the asymmetric Gemini-SDK-missing fallback gap discovered
during preflight — out of scope here because it requires a separate design pass on
deferred-load semantics in `gemini-embedder.ts`.
