# Context Caching

Totem automatically leverages LLM prompt caching to significantly reduce the cost and latency of governing your codebase.

Currently, Context Caching is supported when using **Anthropic** models (specifically `claude-sonnet-4-6` via the `anthropic:` provider prefix). It utilizes Anthropic's `cache_control` markers to cache the static portions of your prompts.

**This feature requires zero configuration.** It is enabled automatically for all supported operations in Totem 1.14.0+.

## How it Works

When Totem communicates with the LLM, it splits the prompt into static and dynamic sections.

**Cached (Static) Portions:**

- The core compiler system prompt
- The `ast-grep` syntactic cheat sheet
- Compound pattern examples and few-shot learning data

**Uncached (Dynamic) Portions:**

- The specific lesson content currently being compiled or reviewed
- Telemetry IDs and dynamic directives

Anthropic's caching operates on a **sliding 5-minute TTL (Time To Live)**.
When you run a command like `totem compile`, the first lesson compiled will incur the full input token cost to write the static context into the cache. Every subsequent lesson compiled within 5 minutes will read that static context from the cache at a fraction of the price.

Because the TTL resets on every cache hit, a bulk recompile of 50+ rules (which might take 15 minutes) will stay "warm" end-to-end, caching the system prompt for the entire duration of the run.

_(Note: Placing dynamic content inside the cached section of a prompt is an anti-pattern that invalidates the cache on every call. Totem's prompts are explicitly architected to isolate dynamic user data at the end of the payload.)_

## Provider Coverage

- **Anthropic:** Fully supported for `totem compile` and `totem review` when using `anthropic:claude-sonnet-4-6`.
- **Google Gemini:** Deferred pending feature parity with the Anthropic CachedContent API.
- **Other Providers:** No caching layer is currently implemented.

_(Note regarding Cloud Compilation: The self-hosted cloud worker is currently Gemini-only and does **not** benefit from this caching layer. For the lowest cost and highest quality compilation, use local compilation with Anthropic models. Migration of the cloud worker to Claude Sonnet is tracked as [mmnto/totem#1221](https://github.com/mmnto-ai/totem/issues/1221).)_

## Cost Expectations

While exact savings depend on your specific lesson length and the provider's current pricing, a bulk recompile of 20+ lessons typically saves a significant percentage of input token costs compared to an uncached run, because the heavy compiler system prompt is only billed once.

## Verifying the Cache

You can verify that context caching is working by observing the CLI output during a compilation run.

When a cache hit occurs, Totem will log a dimmed message to `stderr`:
`[Compile] cache hit: 14,205 tokens read from prompt cache`

On the first compile call in a 5-minute TTL window, you'll see the companion message instead:
`[Compile] cache write: 14,205 tokens (first call in TTL window)`

The first call pays full input token cost to write the static context into the cache; every subsequent call within 5 minutes reads from it.

Cache hit and cache write messages are emitted by default in normal compile output (they're dimmed but present) — no flag required. If you make several compile calls in rapid succession within a 5-minute window and you see `cache write: N tokens` on every call instead of `cache hit: N tokens`, the cache is being invalidated on each call — most likely because dynamic content has been placed inside the cached section of the prompt.
