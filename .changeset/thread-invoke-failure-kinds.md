---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

thread slice-B invoke-failure kinds into the verdict lane surface (#2459)

Slice B (#2457) produces a structured `OrchestratorInvokeError` — a bounded `kind`
(`auth | quota | model | process-spawn | process-exit | timeout | unknown`), ordered
attempt evidence, and an optional content-addressed `failureArtifactHash` — but slice
A's verdict-lane surface collapsed every execution failure into the single coarse
`invoke-error`. This threads B's evidence through to the verdict and the operator.

Core (`@mmnto/totem`): `VerdictLaneFailureReason` is widened additively with the
execution-phase invoke kinds (`invoke-auth`, `invoke-model`, `invoke-process-spawn`,
`invoke-process-exit`, `invoke-timeout`); `quota` and `unknown` reuse the pre-existing
`quota-exhausted` / `invoke-error`, so the mapping is 1:1 and nothing collapses. A
`failed` lane gains an optional `failureArtifactHash` that reaches B's bounded evidence
one hop away, mirroring how a completed lane reaches its run artifact via
`runArtifactHash`; when recorded it resolves via `loadInvocationFailureArtifact`. The
verdict-artifact schema version bumps `1.1.0 → 1.2.0` — a minor and reader-tolerance
step per the 1.x F1 policy: the widening is purely additive (new enum members plus an
optional field), so every prior 1.x verdict still parses unchanged.

CLI (`@mmnto/cli`): `classifyRejectedLane` consumes the structured
`OrchestratorInvokeError` (its `kind` and `failureArtifactHash`) instead of inferring
the category from error prose, and records the evidence hash on the failed lane. Per the
#2471 gate-semantics boundary, an admission-phase `TotemConfigError` maps to
`config-error` — it never reached execution, so it is never mapped to a widened
`invoke-*` kind. The zero-completed hard-error message now names the per-lane failure
categories (e.g. `failed by category: invoke-auth (1), invoke-timeout (1)`) so a
provider-unsettled round shows the operator auth vs quota vs timeout, not just counts.

The merged slice-A zero-completed exit contract is unchanged: the five-shape exit matrix
still passes, and the `completed=0, abstained=N, failed=M` count line is preserved
verbatim.
