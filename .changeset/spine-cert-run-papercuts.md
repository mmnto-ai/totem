---
'@mmnto/cli': patch
---

spine: cert-run papercuts (#2237) — record `loadEnv`, freeze auto-seals `llmReplaySha`, persist firing detail on FAIL

Three fix-forwards the first end-to-end Gate-1 cert run (strategy#709) surfaced — each a gap that only showed up because the pipeline had never run live before:

- **`spine windtunnel record` now `loadEnv(cwd)`** before resolving the provider credential, so an `.env`-only `ANTHROPIC_API_KEY` is visible. The spine commands (unlike ~18 others) did not load `.env`, so `record` fail-closed as "no credential resolved" until the key was exported by hand.
- **`freeze` now auto-SEALS `controls.integrity.llmReplaySha`** from the frozen `llm-replay.v1.json` — the two-phase lock's documented sealer (materialize omits it, record produces it, freeze seals it). It computes the same `computeArtifactHash` the run re-verifies, so the operator no longer hand-edits the lock. Absent fixture on a certifying lock warns (mirroring `prDiffsSha`/`groundTruthSha`).
- **The certifying-run report now persists per-firing detail** (rule, pr, file, matched-line) REGARDLESS of verdict. Previously a FAIL / honest-negative run kept only the `needsAdjudication` labelId hashes, so the firings were not observable for blind-by-pattern adjudication.
