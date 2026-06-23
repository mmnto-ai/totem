---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

spine: extractor-yield β (bot-review substrate + chrome normalization) + γ (RESOLVED-eligibility) — strategy#709 yield-fix PR-2

Builds on slice α (the NO-DRAFT cause-tags that made the moat measurable). Strategy ruled the first Gate-1 cert run's honest-negative is a pipeline input-hygiene + class-coverage loss, not a thesis failure — these two levers address the dominant extract→draft leak. Both move `extractorInputKey`, so the cert-#1 fixture invalidates by design (one clean re-record is the decisive cert re-run).

**β — bot-review substrate + chrome normalization (panel OQ-β1..β4):**

- **`reviewBotIdentity`** (core, `selection-rule.ts`): a NEW allowlist predicate recognizing review-FINDING bots (`gemini-code-assist` / `coderabbitai`, with/without a `[bot]` suffix), kept DELIBERATELY SEPARATE from `isBotIdentity` (which still gates `[bot]`-authored corpus membership, unchanged). Allowlist-not-denylist: a not-yet-listed tool undercounts rather than laundering every future automation account in.
- **`substantiveCommentCount`** (replaces `humanCommentCount`): counts human + recognized review-bot comments as substrate; still excludes unrecognized `[bot]` noise (renovate/dependabot) + empty bodies. For this bot-reviewed cert corpus, gemini/CR review comments ARE legitimate substrate.
- **`normalizeReviewChrome`** (core, new `review-normalize.ts`): a deterministic, idempotent, audit-preserving strip of bot-review chrome (severity badges, `<details>` collapsibles, HTML comments) — raw `body` kept, `normalizedBody` added. The extractor prompt renders it and `extractorInputKey` digests it; `REVIEW_CHROME_NORMALIZER_VERSION` folds into the replay provenance, so a normalizer change re-keys (replay miss) AND flips the integrity hash → re-record forced (Tenet-15).
- **`authorKind` + source-tag**: each `ReviewThreadComment` carries `authorKind`; each draft carries a `DraftSourceKind` (`human|bot|mixed`) computed from its eligible threads, serialized onto the §8 emission ledger (NOT the reused `ProvenanceRecord`) + the zero-draft drop — a non-FM Tenet-19 diagnostic that makes the bot-substrate share observable.

**γ — RESOLVED unconditional (strategy class-coverage lever):**

- **`eligibleThreads`** narrows from `!isResolved && !isOutdated` to `!isOutdated`: a RESOLVED thread is the highest-signal legitimacy marker (a defect a reviewer raised AND the author confirmed by fixing), so it is now ADMITTED; only OUTDATED (diff-hunk-stale) threads stay excluded. The core gate and the replay-key eligibility move in LOCKSTEP.
- Drop-reason hygiene: `resolved-rejected` → `outdated-rejected` (the gate now drops only on outdated), and the zero-draft drop gets its own `no-draft` reason code (slice α had mislabeled a legitimate model decline as `unparseable`; `noDraftCause` carries the precise sub-reason).

No FM falsifier is touched — `authorKind` / `sourceKind` / `noDraftCause` are all diagnostics, and the eligibility narrowing is a curation property. Test-first / mock-driven, zero live LLM in CI.
