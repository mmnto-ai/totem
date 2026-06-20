---
'@mmnto/cli': minor
---

Gate-1 miner slice 5b-ii (ADR-111): the LIVE LLM adapters that complete the
record/replay scaffold from 5b-i. Adds `LiveDraftExtractor` / `LiveDraftClassifier`
(structural implementations of the core `DraftExtractor` / `DraftClassifier` ports
that drive an injected, provider-routed `InvokeOrchestrator` seam — never
`runOrchestrator`, so no response cache can replay a stale answer as a fresh live
call), the frozen miner extract/classify prompts, and the fail-loud guards: a
construction-time `verifyLlmAdapterConfig` plus an end-of-run `assertPipelineProductive`
floor (`all-items-failed ⟹ throw`, so a dead provider can't masquerade as
structural-signal sparsity), a closed-set classifier parse (`classified` only for a
single unambiguous label, else the low-privilege `{behavioral, error-default}`
safe-default), an `assertLiveLlmAllowed` CI guard, and a `buildReplayProvenance`
helper that binds the prompt/provider provenance the 5b-i integrity gate covers (a
prompt edit forces a re-record). Per-item failures stay fail-soft (`[]` / safe-default,
never throw). STUB-seam-tested — NO live LLM, NO network in CI; the live wiring +
record run land in slice 5c.
