# Context Caching

When running bulk operations like `totem compile` across dozens of lessons, the token cost and latency of sending the massive system prompt on every API call became prohibitive. Context Caching leverages LLM prompt caching to solve this friction.

Context Caching is supported on the **Anthropic** provider (`anthropic:` prefix). Totem uses Anthropic's `cache_control` markers to cache the static portions of your prompts; cache savings appear automatically once the provider returns prompt-cache usage metrics on the response.

## Enabling Context Caching (Opt-In Preview in 1.14.0)

Context Caching ships in Totem 1.14.0 as an **opt-in preview**. The plumbing is in place — orchestrator middleware, `cache_control` markers on the static prompt sections, per-call cache metric tracking — but the feature defaults to **off** so existing users aren't surprised mid-cycle by a behavior change in their token usage profile. Default activation is tracked for 1.15.0 in [mmnto/totem#1291](https://github.com/mmnto-ai/totem/issues/1291).

To enable it for the 1.14.0 preview, add the flag to your `totem.config.ts`:

```typescript
export default {
  // ... other config ...
  enableContextCaching: true,
};
```

That's the only change required. The next `totem lesson compile` or `totem review` invocation against an Anthropic provider will start writing to and reading from the prompt cache.

## How it Works

When Totem communicates with the LLM, it splits the prompt into static and dynamic sections.

**Cached (Static) Portions:**

- The core compiler system prompt
- The `ast-grep` syntactic cheat sheet
- Compound pattern examples and few-shot learning data

**Uncached (Dynamic) Portions:**

- The specific lesson content currently being compiled or reviewed
- Telemetry IDs and dynamic directives

Anthropic's caching operates on a **sliding TTL (Time To Live)** that resets on every cache hit. The TTL is configurable via the `cacheTTL` option in `totem.config.ts` and is constrained to two values that Anthropic supports natively:

- **`cacheTTL: 300`** (5 minutes) — the default. Ephemeral cache, ~10% of normal input token cost on read.
- **`cacheTTL: 3600`** (1 hour) — extended cache. ~2x write cost on the first call, but lets the cache survive longer gaps between operations.

When you run a command like `totem lesson compile`, the first lesson compiled will incur the full input token cost (plus any extended-cache premium) to write the static context into the cache. Every subsequent lesson compiled within the active TTL window will read that static context from the cache at lower cost.

Because the TTL resets on every cache hit, a bulk recompile of 50+ rules (which might take 15+ minutes on the default 5-minute TTL) will stay "warm" end-to-end as long as compile operations land inside the sliding window. For workflows where you make a request, walk away, and come back later (e.g. automated reviews triggered hours apart), set `cacheTTL: 3600` to keep the cache warm across the gap.

_(Note: Placing dynamic content inside the cached section of a prompt is an anti-pattern that invalidates the cache on every call. Totem's prompts are explicitly architected to isolate dynamic user data at the end of the payload.)_

## Provider Coverage

- **Anthropic:** Supported for `totem lesson compile` and `totem review` on any `anthropic:` model that returns prompt-cache usage metrics on the response. Caching activates when `enableContextCaching: true` is set in your config and the provider returns the cache metrics — there's no specific model-name gate.
- **Google Gemini:** Deferred pending integration with the Gemini `CachedContent` API. Tracked for 1.16.0+.
- **Other Providers:** No caching layer is currently wired into the orchestrator middleware.

_(Note regarding Cloud Compilation: The self-hosted cloud worker is currently Gemini-only and does **not** benefit from this caching layer. For the lowest cost and highest quality compilation, use local compilation with Anthropic models. Migration of the cloud worker to Claude Sonnet is tracked as [mmnto/totem#1221](https://github.com/mmnto-ai/totem/issues/1221).)_

## Cost Expectations

While exact savings depend on your specific lesson length and the provider's current pricing, a bulk recompile of 20+ lessons typically saves a significant percentage of input token costs compared to an uncached run, because the heavy compiler system prompt is only billed once.

## Verifying the Cache

You can verify that context caching is working by observing the CLI output during a compilation run.

When a cache hit occurs, Totem will log a dimmed message to `stderr`:
`[Compile] cache hit: 14,205 tokens read from prompt cache`

On the first compile call in a TTL window, you'll see the companion message instead:
`[Compile] cache write: 14,205 tokens (first call in TTL window)`

The first call pays full input token cost to write the static context into the cache; every subsequent call within the configured `cacheTTL` window reads from it.

When the provider returns cache usage metrics, cache hit/write messages appear in normal compile output (dimmed). If you make several compile calls in rapid succession within the active TTL window and you see `cache write: N tokens` on every call instead of `cache hit: N tokens`, the cache is being invalidated on each call — most likely because dynamic content has been placed inside the cached section of the prompt. If you see no cache messages at all, verify that `enableContextCaching: true` is set in your `totem.config.ts` and that you're using an `anthropic:` provider.
