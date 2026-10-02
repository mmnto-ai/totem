## Lesson — Fail a knob's tests through refusals a real config reaches

**Tags:** testing, configuration, shield
**Scope:** packages/cli/src/commands/shield-nonreview.test.ts, packages/cli/src/commands/shield-enforce.test.ts

The exit knob's integration cases first failed through `review.lanes: 12345`, a config the real loader rejects, so they proved nothing about a failure raised after the config loads. They now fail through two refusals a schema-valid config reaches in production: `No model specified` (thrown by the real orchestrator, with the embedder and an empty store stubbed) and `No embedding provider configured` (no stub at all), each on the knob's three faces. The check that the tests bite: with `advisory` made non-softening, exactly the two new `advisory` cases fail (mmnto-ai/totem#2995, a bot finding verified against the loader).
