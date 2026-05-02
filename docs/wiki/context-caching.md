# Context Caching

When running bulk operations like `totem lesson compile` across dozens of lessons, the token cost and latency of sending the heavy system prompt on every API call can become prohibitive. Context Caching uses LLM prompt caching to absorb that cost.

Context Caching is supported on the **Anthropic** provider (`anthropic:` prefix). Totem applies Anthropic's `cache_control` markers to the static portions of compile and review prompts; cache savings appear automatically once the provider returns prompt-cache usage metrics on the response.

## Enabling Context Caching

Context Caching is opt-in. The substrate has been in place since 1.14.0 (orchestrator middleware, `cache_control` markers on the static prompt sections, per-call cache metric tracking), and the feature defaults to off so existing users are not surprised by a sudden change in their token-usage profile.

Add the flag to your `totem.config.ts`:

```typescript
export default {
  // ... other config ...
  enableContextCaching: true,
};
```

That is the only change required. The next `totem lesson compile` or `totem review` invocation against an Anthropic provider will start writing to and reading from the prompt cache.

## How It Works

Totem splits the prompt into static and dynamic sections.

**Cached (static) portions:**

- The core compiler system prompt
- The `ast-grep` syntactic cheat sheet
- Compound pattern examples and few-shot learning data

**Uncached (dynamic) portions:**

- The specific lesson content currently being compiled or reviewed
- Telemetry IDs and dynamic directives

Anthropic's caching uses a **sliding TTL (Time To Live)** that resets on every cache hit. The TTL is configurable via the `cacheTTL` option in `totem.config.ts` and is constrained to two values that Anthropic supports natively:

- **`cacheTTL: 300`** (5 minutes, the default). Ephemeral cache; reads at ~10% of normal input token cost.
- **`cacheTTL: 3600`** (1 hour, extended cache). ~2x write cost on the first call; the cache survives longer gaps between operations.

When you run `totem lesson compile`, the first lesson compiled incurs the full input token cost (plus any extended-cache premium) to write the static context into the cache. Every subsequent lesson compiled within the active TTL window reads that static context from the cache at lower cost.

Because the TTL resets on every cache hit, a bulk recompile of 50+ rules (which might take 15+ minutes on the default 5-minute TTL) stays cache-warm end to end as long as compile operations land inside the sliding window. For workflows where you make a request, walk away, and come back later (e.g. automated reviews triggered hours apart), set `cacheTTL: 3600` to keep the cache warm across the gap.

_(Note: Placing dynamic content inside the cached section of a prompt is an anti-pattern that invalidates the cache on every call. Totem's prompts isolate dynamic user data at the end of the payload.)_

## Provider Coverage

- **Anthropic:** Supported for `totem lesson compile` and `totem review` on any `anthropic:` model that returns prompt-cache usage metrics on the response. Caching activates when `enableContextCaching: true` is set in your config and the provider returns the cache metrics. There is no specific model-name gate.
- **Google Gemini:** Deferred pending integration with the Gemini `CachedContent` API.
- **Other Providers:** No caching layer is currently wired into the orchestrator middleware.

_(Note regarding Cloud Compilation: The self-hosted cloud worker is currently Gemini-only and does **not** benefit from this caching layer. For the lowest cost and highest quality compilation, use local compilation with Anthropic models. Migration of the cloud worker to Claude Sonnet is tracked as [mmnto-ai/totem#1221](https://github.com/mmnto-ai/totem/issues/1221) and remains open.)_

## Cost Expectations

Exact savings depend on lesson length and the provider's current pricing, but a bulk recompile of 20+ lessons typically saves a significant percentage of input token costs compared to an uncached run, because the heavy compiler system prompt is only billed once.

## Verifying the Cache

You can verify that context caching is working by observing the CLI output during a compilation run.

When a cache hit occurs, Totem logs a dimmed message to `stderr`:
`[Compile] cache hit: 14,205 tokens read from prompt cache`

On the first compile call in a TTL window, you see the companion message instead:
`[Compile] cache write: 14,205 tokens (first call in TTL window)`

The first call pays full input token cost to write the static context into the cache; every subsequent call within the configured `cacheTTL` window reads from it.

When the provider returns cache usage metrics, cache hit/write messages appear in normal compile output (dimmed). If you make several compile calls in rapid succession within the active TTL window and you see `cache write: N tokens` on every call instead of `cache hit: N tokens`, the cache is being invalidated on each call. The most likely cause is dynamic content placed inside the cached section of the prompt. If you see no cache messages at all, verify that `enableContextCaching: true` is set in your `totem.config.ts` and that you are using an `anthropic:` provider.
