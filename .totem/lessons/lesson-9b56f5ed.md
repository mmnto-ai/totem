## Lesson — Lesson — GCA decline protocol: Pack publish-flips

**Tags:** review-guidance, gca, pack-distribution, pnpm-workspace, sigstore, publish-pipeline, adr-097

# Lesson — GCA decline protocol: Pack publish-flips and `workspace:*` references

**Context:** PR #1780 flipped `@mmnto/pack-rust-architecture` from `private: true` to `private: false` (one-line change) to unblock ADR-097 § Stage 1's alpha-pilot consumer trigger (`liquid-city` consuming the pack via `extends:`). GCA flagged the flip on two grounds — both declined.

## Decline 1 — "Security-sensitive packages must remain private until Sigstore signing exists"

GCA cited a "General Rule" requiring packages of architectural-governance content to remain `private: true` until cryptographic signing infrastructure exists.

**Why declined:** Hallucinated rule citation. Zero hits for `private: true | cryptographic | Sigstore | signing` anywhere in `.gemini/styleguide.md` at the time of the review. The Sigstore + in-toto verification gate is tracked separately in `mmnto-ai/totem#1492` and is open / tier-2 / pre-implementation. Alpha-pilot publishes during ADR-097 § Stage 1 are explicitly exempted in the canonical gating ticket (`mmnto-ai/totem#1779`) — the exemption is the deliberate strategic decision per dev-Gemini synthesis 2026-05-01: "alpha-soak inside a workspace vacuum is deferred friction, not validation." When `#1492` ships, both `@mmnto/pack-*` packages re-flow through the gate as part of normal pack-publish discipline.

## Decline 2 — "`workspace:*` reference produces invalid registry package"

GCA claimed making the pack public while it has `"@mmnto/totem": "workspace:*"` in `devDependencies` would produce an invalid package on the registry.

**Why declined:** Empirically falsified by the live cohort. `@mmnto/cli@1.23.0` (published ~4 hours before PR #1780 opened, via the same `changeset publish` pipeline) has `"@mmnto/totem": "workspace:*"` in source `dependencies`, but `npm view @mmnto/cli@1.23.0 dependencies` returns `'@mmnto/totem': '1.23.0'`. The pnpm + changesets publish pipeline transforms the workspace protocol at `pnpm publish` time — automatic, not a publish-blocker. The same transform applies to every fixed-group cohort member. Additionally, the rust pack's `workspace:*` is in `devDependencies`, which registry consumers don't install regardless of the source spec.

## Pattern reinforced — GCA decline protocol (per GEMINI.md)

When declining a GCA finding:

1. **Update `.gemini/styleguide.md` §6** with the specific declined pattern so the rule is in the styleguide on the next review pass.
2. **Capture the architectural reasoning as a lesson with the `review-guidance` tag** (this lesson type) so the knowledge base records the rationale for future cross-agent context.
3. **Post ONE consolidated `@gemini-code-assist` issue comment** addressing all findings as a numbered list, in the order GCA raised them. Sub-thread direct-replies are not the protocol path when a substrate/styleguide change is made — they are reserved for the no-substrate-change case (quota-preservation when no re-eval is needed).

This is the first `review-guidance` lesson in the corpus — establishing the precedent. The wider protocol-hygiene sweep across all three repos is queued separately.

## When to apply

When a GCA finding is incorrect or contradicted by the project's own state (live cohort behavior, ticket-authorized exemptions, missing styleguide entries), do not just reply — codify the decline so future reviews don't re-raise it. The bot's per-comment prompts evaluate against PR snapshots without full repo context, which makes hallucinated rule citations and out-of-date corpus claims a recurring class.

**Source:** mcp (added at 2026-05-01T18:29:29.673Z)
