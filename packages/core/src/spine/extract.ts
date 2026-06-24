// ─── ADR-111 Stage-1 Extract (slice 2; slice 5a resolution gate): review-thread → draft DSL ──
//
// The miner's deterministic Extract stage. It iterates the frozen split's TRAIN
// slice ONLY, fetches each PR's review thread through an injected port, applies
// the resolution-eligibility gate (slice 5a: drop resolved/outdated threads,
// mmnto-ai/totem#2201), runs a completeness check (≥1 HUMAN review comment on
// the surviving threads), drafts zero-or-more lesson-markdown DSL bodies through
// an injected `DraftExtractor` port, and either carries a transient
// `DraftCandidate` or loud-drops to the drop ledger with a reason code. It writes
// the drop + API-usage ledgers and the in-run seed-blindness fact.
//
// ZERO real LLM lives here: the `DraftExtractor` is a port, mocked in tests (the
// #2188 mock-first discipline); the live LLM adapter rides a later slice. Core
// stays network-free + LLM-free + deterministic — IO (GitHub fetch, the LLM
// call) is the CLI layer's, injected as ports (the `Stage4VerifierDeps` DI
// pattern).
//
// ADR-111 boundaries this module enforces:
//   §1 unverified-only       — Extract mints nothing; `DraftCandidate` is a
//                              transient stage-internal value, never the §3
//                              `CandidateRuleRecord` (minted in slice 3).
//   §6 fail-loud, no degrade  — every content/provenance/draft failure is a LOUD
//                              drop-ledger entry, never a thinner extraction.
//   §6 train-only fetch       — held-out / control / excluded PRs are NEVER
//                              fetched (FM h); `heldOutFetchCount` is recomputed
//                              from the frozen split, not trusted.
//   §7 seed-blindness         — the extractor is never handed a seed class (FM f);
//                              the fact is carried here, serialized into the
//                              emission ledger in slice 3 (single home, Tenet 20).
//   FM(i) (slice-2 half)      — every `trainPr` has draftCount + dropCount >= 1;
//                              none silently skipped.
//
// lesson-markdown is the DSL *syntax* (ADR-058 Pipeline 1/3 target), NOT a
// Pipeline-1 trust class: every draft body is `unverified` and Stage-4-gated by
// the slice-4 compiler, never a manual-rule trust bypass.

import { z } from 'zod';

import { type ProvenanceRecord, ProvenanceRecordSchema } from '../compiler-schema.js';
import { TotemParseError } from '../errors.js';
import { extractManualPattern } from '../lesson-pattern.js';
import type {
  ApiUsageLedger,
  ApiUsageLedgerEntry,
  DraftSourceKind,
  DropLedger,
  DropLedgerEntry,
  DropReasonCode,
  NoDraftCause,
} from './ledgers.js';
import { NoDraftCauseSchema } from './ledgers.js';
import { isBotIdentity, reviewBotIdentity } from './selection-rule.js';
import type { SplitArtifact } from './split.js';

// ── Parsed review-thread content (the fetch port's payload) ───────────────────

/** A single parsed review-thread comment (provider-neutral; mirrors the CLI `groupIntoThreads` shape). */
export interface ReviewThreadComment {
  author: string;
  /** The RAW comment body, kept verbatim for audit (slice β: `normalizedBody` is the de-chromed twin). */
  body: string;
  /**
   * Author classification (slice β, strategy#709). `'bot'` iff the author is a
   * recognized review-FINDING bot (`reviewBotIdentity` — gemini-code-assist /
   * coderabbitai); `'human'` otherwise (a human author OR an unrecognized
   * automation account — the latter is excluded from the substantive count by the
   * separate `isBotIdentity` denylist check, and is rare on inline review threads).
   * Set at the CLI mapping boundary via core's `classifyAuthorKind`; the count +
   * source-tag READ it (its single classification home).
   */
  authorKind: AuthorKind;
  /**
   * The de-chromed body the extractor actually consumes (slice β). For a `'bot'`
   * comment this is `normalizeReviewChrome(body)` (severity badges / `<details>`
   * collapsibles / footer chrome stripped); for a `'human'` comment it equals the
   * raw `body` (CRLF→LF + trim only — human prose carries no review-bot chrome).
   * The extractor prompt renders THIS, and `extractorInputKey` digests THIS (not
   * the raw body), so the key reflects exactly what the LLM saw (panel OQ-β3).
   */
  normalizedBody: string;
}

/** Recognized-review-bot (`'bot'`) vs human/unrecognized (`'human'`) — see `ReviewThreadComment.authorKind`. */
export type AuthorKind = 'bot' | 'human';

/**
 * A single review thread on a file path.
 *
 * `isResolved` / `isOutdated` (slice 5a, mmnto-ai/totem#2201) are the per-thread
 * resolution signal the live `ReviewThreadSource` adapter SURFACES from the
 * GitHub `reviewThreads` payload — it does NOT filter on them. CRITICAL contract
 * (the contract-owner ruling): the adapter fetches resolved/outdated threads WITH
 * their flags and hands them to core; CORE decides eligibility + drop-ledgers (so
 * every resolution rejection is auditable, §8 "every rejection ledgered"). A
 * server-side / client-side `isResolved:false` pre-filter is FORBIDDEN — it would
 * make the rejection unledgered (a silenced §6/FM violation).
 */
export interface ReviewThread {
  path: string;
  comments: ReviewThreadComment[];
  /**
   * GitHub `reviewThreads.isResolved` — the author marked this thread resolved.
   * Slice γ (strategy#709): RESOLVED no longer excludes a thread — a resolved
   * thread is the highest-signal LEGITIMACY marker (a defect the reviewer raised
   * AND the author confirmed by fixing). Surfaced for audit/identity; `isOutdated`
   * is now the SOLE eligibility filter. See `eligibleThreads`.
   */
  isResolved: boolean;
  /** GitHub `reviewThreads.isOutdated` — the thread's diff hunk no longer matches HEAD. */
  isOutdated: boolean;
}

/**
 * The CONTENT side of a train PR, returned by the injected `ReviewThreadSource`.
 * Content-only (ADR-111 §6): it never influences corpus membership / the split /
 * control selection — the offline `selectionRule` is the sole membership oracle.
 */
export interface ReviewThreadContent {
  pr: number;
  /** Lowercase 40-hex merge-commit SHA (lc is squash-merge) — becomes the candidate's `provenance.commitSha`. */
  mergeCommitSha: string;
  threads: ReviewThread[];
}

/**
 * The fetch outcome. §6 BINDING: distinguish "never fetched" (`unreachable`)
 * from "fetched but unusable" (`unparseable`) — they route to different drop
 * reason codes, so the §8 done-criterion can tell a broken fetch from thin
 * content. A discriminated result keeps that distinction at the source layer
 * rather than collapsing both into a `null`.
 */
export type FetchResult =
  | { kind: 'ok'; content: ReviewThreadContent }
  | { kind: 'unreachable'; detail?: string }
  | { kind: 'unparseable'; detail?: string };

// ── Transient Extract output ─────────────────────────────────────────────────

/**
 * A transient, stage-internal Extract output — NOT the §3 `CandidateRuleRecord`,
 * NOT persisted, NOT a ledger row. Slice-3's classifier maps `DraftCandidate →
 * CandidateRuleRecord` by adding the structural/behavioral disposition + its
 * classifier-ledger reference. The miner's SOLE OUTPUT envelope remains the
 * `CandidateRuleRecord`, minted in slice 3 — this is just the funnel value that
 * flows Extract → Classify.
 */
export interface DraftCandidate {
  provenance: ProvenanceRecord;
  /**
   * The LLM-drafted lesson-markdown body (ADR-103 compiler input). `unverified`
   * and Stage-4-gated downstream — lesson-markdown is the syntax, not a
   * Pipeline-1 trust class. Guaranteed non-empty and carrying a usable
   * `**Pattern:**` / yaml rule by the syntactic preflight.
   */
  dslSource: string;
  /**
   * The SUBSTRATE provenance (slice β, strategy#709): whether the eligible threads
   * this PR drafted from carried `human`, `bot` (recognized review-bot), or `mixed`
   * comments. A TRANSIENT diagnostic (Tenet-19, not an FM falsifier) carried to
   * Classify, which serializes it onto the §8 emission ledger (panel OQ-β4 — NOT
   * the reused `ProvenanceRecord`/legitimacy stamp). PR-level coarse-grained (a
   * single draft can derive from a mix), so a per-candidate tag mirrors its PR.
   */
  sourceKind: DraftSourceKind;
}

// ── Injected ports (core-defined, CLI-implemented — the Stage4VerifierDeps DI) ─

/**
 * Injected review-thread fetch port (ADR-111 §6 content-only). Core-defined,
 * CLI-implemented — keeps core network-free. ASYNC: the CLI impl wraps the
 * GitHub API (network IO). MUST be called for train PRs only; the orchestrator
 * guarantees that by iterating the train slice.
 */
export interface ReviewThreadSource {
  fetch(pr: number): Promise<FetchResult>;
}

/**
 * The `DraftExtractor` port's return: the zero-or-more draft bodies PLUS, when the
 * list is empty, WHY (`noDraftCause`). The cause is the extract-stage twin of the
 * classifier's `dispositionSource` (a non-FM Tenet-19 diagnostic) — a bare `[]`
 * conflated ≥6 causes (model declined / parser rejected a valid draft / transient
 * invoke failure) the funnel could not tell apart. INVARIANT (refined): a cause is
 * present IFF `drafts` is empty — a non-empty result carries drafts and no cause;
 * an empty result MUST name its cause. Parsed at the core boundary so a
 * contract-violating port (cause-without-empty, or empty-without-cause) fails loud
 * before the drop ledger, exactly as `ClassifierResultSchema.parse` guards classify.
 */
export const DraftResultSchema = z
  .object({
    drafts: z.array(z.string()),
    noDraftCause: NoDraftCauseSchema.optional(),
  })
  .refine((r) => (r.drafts.length === 0) === (r.noDraftCause !== undefined), {
    message:
      'noDraftCause must be present iff drafts is empty (the extract-stage diagnostic invariant)',
    path: ['noDraftCause'],
  });
export type DraftResult = z.infer<typeof DraftResultSchema>;

/**
 * Injected draft-DSL extractor port. ASYNC: the CLI impl wraps the LLM call
 * (network IO). List-shaped (fold 1): one thread can carry multiple structural
 * invariants, so it returns ZERO-or-more draft bodies in `DraftResult.drafts`. The
 * LLM lives behind this at the CLI layer (draft-only, Tenet-15); a deterministic
 * fixture impl drives tests. The miner is BLIND to seed classes (§7 / FM f): the
 * port is never handed one.
 *
 * Error contract: returns `{ drafts: [], noDraftCause }` when it cannot draft —
 * INCLUDING on its own internal/transient failure (the CLI adapter catches its
 * LLM/network errors and surfaces `{ drafts: [], noDraftCause: 'invoke-error' }`).
 * It MUST NOT throw for a per-PR content failure: an empty list is a loud,
 * cause-tagged drop below (FM-i-creditable), whereas a throw would abort the whole
 * mining run. Keeping per-PR error handling in the adapter keeps the core
 * orchestrator Tenet-4-clean (no swallowing catch); a contract-violating throw
 * therefore propagates loudly rather than being silently absorbed.
 */
export interface DraftExtractor {
  draft(content: ReviewThreadContent): Promise<DraftResult>;
}

/** Dependencies for a single Extract-stage run. */
export interface ExtractStageDeps {
  source: ReviewThreadSource;
  extractor: DraftExtractor;
  /**
   * §7 seed-blindness fact, established in-run: `true` iff a seed class WAS
   * supplied to the extractor (which would falsify FM f). Carried here; slice 3
   * SERIALIZES it into the §8 emission ledger's `extractionInputsAttestation`
   * (single persisted home, Tenet 20). Slice 2 establishes the fact; it does not
   * grow a second store for it.
   */
  seedClassesProvided: boolean;
}

/** The Extract stage's output: transient drafts + the two ledgers Extract owns. */
export interface ExtractStageResult {
  /** Transient draft candidates carried forward to slice-3 Classify. */
  drafts: DraftCandidate[];
  /** Drop ledger — the sole disposition for any content/provenance/draft failure (§6). */
  dropLedger: DropLedger;
  /** API-usage ledger — every train-slice fetch; `heldOutFetchCount` MUST be 0 (FM h). */
  apiUsageLedger: ApiUsageLedger;
  /** In-run seed-blindness fact; slice 3 persists it into the emission ledger. */
  seedBlindness: { seedClassesProvided: boolean };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Classify a comment author (slice β, strategy#709). `'bot'` iff it is a recognized
 * review-FINDING bot (`reviewBotIdentity` allowlist — gemini/CR); `'human'`
 * otherwise. The SINGLE classification home: the CLI mapping boundary stamps each
 * comment's `authorKind` via this, and the count + source-tag read that field.
 */
export function classifyAuthorKind(author: string): AuthorKind {
  return reviewBotIdentity(author) ? 'bot' : 'human';
}

/**
 * Is this comment SUBSTANTIVE mining substrate (slice β)? Counts toward §6's
 * "≥1 review comment" completeness threshold iff its body is non-empty AND it is
 * either a recognized review-finding bot (`authorKind === 'bot'`) OR a human.
 *
 * The slice-β substrate flip (panel OQ-β2, ALLOWLIST): for this bot-reviewed cert
 * corpus, gemini/CR review comments ARE legitimate substrate — they count. But an
 * UNRECOGNIZED `[bot]` automation account (renovate / dependabot) is still excluded
 * via the `isBotIdentity` denylist, so future automation noise can never launder
 * itself in as a substantive reviewer. Empty/whitespace bodies never count.
 */
function isSubstantiveComment(comment: ReviewThreadComment): boolean {
  // Gate on what the extractor ACTUALLY consumes (greptile #2242): for a review
  // bot that is the de-chromed `normalizedBody`, so a badge-ONLY comment (non-empty
  // raw `body`, but `normalizedBody === ''` after the strip) is correctly thin —
  // it would otherwise clear the gate yet hand the extractor an empty body and
  // mislead a `no-draft` drop where `truncated` is the truth. Human bodies are
  // never chrome-stripped, so `normalizedBody === body` for them.
  const effectiveBody = comment.authorKind === 'bot' ? comment.normalizedBody : comment.body;
  if (effectiveBody.trim().length === 0) return false;
  if (comment.authorKind === 'bot') return true;
  return !isBotIdentity(comment.author);
}

/**
 * Count SUBSTANTIVE review comments across threads (slice β — replaces the old
 * `humanCommentCount`). A thread set with zero substantive comments is content-thin
 * and must take the loud-drop path, never seed a hallucinated draft.
 */
function substantiveCommentCount(threads: readonly ReviewThread[]): number {
  let count = 0;
  for (const thread of threads) {
    for (const comment of thread.comments) {
      if (isSubstantiveComment(comment)) count++;
    }
  }
  return count;
}

/**
 * The substrate provenance of a thread set (slice β, panel OQ-β4): `human` /
 * `bot` / `mixed` over its SUBSTANTIVE comments only (recognized review-bot vs
 * human; unrecognized-bot noise is excluded, exactly as the count excludes it).
 * Called only when ≥1 substantive comment survives the gate, so at least one axis
 * is non-zero. A non-FM Tenet-19 diagnostic carried onto each draft + the
 * zero-draft drop.
 */
function computeSourceKind(threads: readonly ReviewThread[]): DraftSourceKind {
  let human = 0;
  let bot = 0;
  for (const thread of threads) {
    for (const comment of thread.comments) {
      if (!isSubstantiveComment(comment)) continue;
      if (comment.authorKind === 'bot') bot++;
      else human++;
    }
  }
  if (bot > 0 && human > 0) return 'mixed';
  return bot > 0 ? 'bot' : 'human';
}

/**
 * The eligibility gate. Slice γ (strategy#709) NARROWS this from slice-5a's
 * `!isResolved && !isOutdated` to `!isOutdated` — RESOLVED threads are now ADMITTED.
 *
 * The slice-5a rationale (resolved == superseded contamination) was REVERSED by the
 * Gate-1 cert finding: a RESOLVED thread is the highest-signal LEGITIMACY marker —
 * a defect a reviewer raised AND the author confirmed real by fixing — so excluding
 * it discarded the very evidence the miner wants (exhibit: lc#532's fail-open-on-
 * non-finite, dropped solely for being resolved). Only OUTDATED stays excluded: an
 * outdated thread's diff hunk no longer matches HEAD, so its invariant may have been
 * refactored away — that IS stale. The adapter SURFACES both flags (it never
 * pre-filters); core decides here so every rejection is ledgered (§8). Returns the
 * eligible (surviving) threads only.
 */
function eligibleThreads(threads: readonly ReviewThread[]): ReviewThread[] {
  return threads.filter((t) => !t.isOutdated);
}

/**
 * Syntactic preflight (fold 4): a draft is a usable lesson-markdown DSL body iff
 * `extractManualPattern` yields a manual pattern (a flat `**Pattern:**` or a
 * compound yaml rule). Empty/whitespace, non-empty-but-no-usable-pattern, and an
 * authoring-error throw (yaml fence + non-`ast-grep` engine) all fail → the
 * draft is dropped `unparseable`, never carried as a "successful" candidate
 * merely for being non-empty.
 */
function isUsableDsl(dslSource: string): boolean {
  if (dslSource.trim().length === 0) return false;
  try {
    return extractManualPattern(dslSource) !== null;
  } catch (err) {
    // A TotemParseError is the EXPECTED authoring-error signal (e.g. a yaml fence
    // under a non-ast-grep engine) → the draft is simply not usable DSL. Any OTHER
    // error is an unexpected parser bug and must fail loud (Tenet 4).
    if (err instanceof TotemParseError) return false;
    throw err;
  }
}

/**
 * Build the candidate's provenance tuple, or report why it is incomplete. `pr`
 * and the review-thread ref are always available (we iterate the train slice and
 * synthesize a canonical per-PR thread ref); the realistic failure is a missing
 * or malformed merge-commit SHA, validated against `ProvenanceRecordSchema`
 * (lowercase 40-hex). A candidate that cannot produce a complete tuple is
 * dropped `incomplete-provenance`, never emitted partial (FM a / Tenet 4).
 */
function buildProvenance(
  pr: number,
  content: ReviewThreadContent,
): { ok: true; value: ProvenanceRecord } | { ok: false; reason: string } {
  const parsed = ProvenanceRecordSchema.safeParse({
    mergedPr: pr,
    reviewThread: `pulls/${pr}/comments`,
    commitSha: content.mergeCommitSha,
  });
  if (!parsed.success) {
    return {
      ok: false,
      reason: parsed.error.issues.map((issue) => issue.message).join('; '),
    };
  }
  return { ok: true, value: parsed.data };
}

// ── The Extract stage ─────────────────────────────────────────────────────────

/**
 * Run the deterministic Stage-1 Extract over a frozen split. Deterministic given
 * its deps: identical `split` + deps → identical drafts, drops, and ledgers (the
 * train slice is awaited sequentially, so ordering is stable). The
 * live LLM and GitHub IO are injected ports, so this orchestration is fully
 * CI-locked with a fixture extractor + a strict-spy fetch source.
 *
 * Per train PR (and ONLY train PRs): log the fetch → fetch → on unreachable /
 * unparseable-at-source, loud-drop → eligibility gate (slice γ: drop
 * `outdated-rejected` when the outdated filter empties an otherwise-substantive
 * thread, else `truncated` when thin to begin with) → completeness-check (≥1
 * substantive comment on the survivors) → build provenance → draft zero-or-more
 * bodies from the SURVIVING threads only → preflight each → carry a
 * `DraftCandidate` or loud-drop. Every train PR ends with at least one draft or
 * one drop (FM i, slice-2 half).
 */
export async function runExtractStage(
  split: SplitArtifact,
  deps: ExtractStageDeps,
): Promise<ExtractStageResult> {
  const trainSet = new Set(split.trainPrs);
  const drafts: DraftCandidate[] = [];
  const dropEntries: DropLedgerEntry[] = [];
  const apiEntries: ApiUsageLedgerEntry[] = [];

  const drop = (
    sourcePr: number,
    reasonCode: DropReasonCode,
    detail: string,
    noDraftCause?: NoDraftCause,
    sourceKind?: DraftSourceKind,
  ): void => {
    dropEntries.push({
      sourcePr,
      reasonCode,
      detail,
      ...(noDraftCause ? { noDraftCause } : {}),
      ...(sourceKind ? { sourceKind } : {}),
    });
  };

  // Iterate the TRAIN slice ONLY — held-out / control / excluded PRs are never
  // fetched (§6 / FM h). Deterministic ascending order.
  const trainPrs = [...trainSet].sort((a, b) => a - b);

  for (const pr of trainPrs) {
    // Every attempted content fetch is logged as a train-slice fetch (the audit
    // surface FM h reads). We only ever target train PRs, so this is always
    // `slice: 'train'`.
    apiEntries.push({ targetPr: pr, slice: 'train', fetchKind: 'review-thread' });

    const result = await deps.source.fetch(pr);
    if (result.kind === 'unreachable') {
      drop(pr, 'unreachable', result.detail ?? `review thread unreachable for train PR #${pr}`);
      continue;
    }
    if (result.kind === 'unparseable') {
      drop(pr, 'unparseable', result.detail ?? `review thread unparseable for train PR #${pr}`);
      continue;
    }
    const content = result.content;

    // Content-identity guard: the fetched content MUST be for the requested train
    // PR. A source adapter that returns mismatched content would otherwise mint a
    // draft attributed to the wrong PR — a provenance-integrity failure → loud drop.
    if (content.pr !== pr) {
      drop(
        pr,
        'incomplete-provenance',
        `fetched content PR #${content.pr} does not match requested train PR #${pr}`,
      );
      continue;
    }

    // Eligibility gate (slice γ) — BEFORE the completeness check. The adapter
    // surfaced per-thread `isOutdated` (it never pre-filters); core decides +
    // ledgers here so every rejection is auditable (§8). Filter to eligible
    // (non-outdated; RESOLVED is now admitted) threads and recount SUBSTANTIVE
    // comments (slice β: human + recognized review-bot) on the SURVIVORS only.
    const preFilterSubstantiveCount = substantiveCommentCount(content.threads);
    const survivingThreads = eligibleThreads(content.threads);
    const survivorSubstantiveCount = substantiveCommentCount(survivingThreads);

    if (survivorSubstantiveCount < 1) {
      if (preFilterSubstantiveCount >= 1) {
        // The thread carried substantive content, but the OUTDATED filter is what
        // emptied it → `outdated-rejected` (an eligibility rejection, not thin
        // content). Carry the concrete outdated evidence in the detail.
        const ineligible = content.threads.length - survivingThreads.length;
        drop(
          pr,
          'outdated-rejected',
          `${ineligible} of ${content.threads.length} threads outdated; ${survivorSubstantiveCount} eligible substantive comments remain`,
        );
      } else {
        // Thin to begin with (0 substantive comments BEFORE the gate) — the
        // existing `truncated` path, NOT an eligibility rejection.
        drop(pr, 'truncated', 'no non-empty substantive review comment after bot filtering');
      }
      continue;
    }

    // Provenance must be complete or the PR is dropped, never partial (FM a).
    const provenance = buildProvenance(pr, content);
    if (!provenance.ok) {
      drop(pr, 'incomplete-provenance', provenance.reason);
      continue;
    }

    // Draft from the SURVIVING (eligible) threads ONLY — resolved/outdated threads
    // are excluded from the extractor's input so no draft can be seeded from
    // superseded review discussion (the `content.pr`/`mergeCommitSha` provenance
    // is preserved). Zero-or-more DSL bodies (fold 1, list-shaped). Per the port's
    // error contract the extractor returns [] on a per-PR failure (the CLI adapter
    // catches its own LLM/network errors) — so the core needs no swallowing catch
    // (Tenet 4). An empty list is a loud drop below, not a silent skip.
    const eligibleContent: ReviewThreadContent = { ...content, threads: survivingThreads };
    // The substrate provenance (slice β, Tenet-19 diagnostic) of THIS PR's eligible
    // threads — carried onto every draft + the zero-draft drop (panel OQ-β4).
    const sourceKind = computeSourceKind(survivingThreads);
    // Parse the port result at the boundary (mirrors ClassifierResultSchema.parse in
    // classify.ts): a contract-violating DraftResult (empty-without-cause or
    // cause-without-empty from a buggy adapter) fails loud HERE, before the ledger.
    const draftResult = DraftResultSchema.parse(await deps.extractor.draft(eligibleContent));
    const draftBodies = draftResult.drafts;

    if (draftBodies.length === 0) {
      // A complete thread that yields no draft is a loud drop (keeps the train PR
      // creditable under FM i), not a silent skip. Reason code `no-draft` (slice β,
      // strategy β-watch): the slice-α empty-draft drop reused `unparseable`, which
      // was semantically wrong for a legitimate model decline (`none-sentinel`) —
      // the coarse code now NAMES the no-draft case while `noDraftCause` (Tenet-19
      // diagnostic) carries the precise sub-reason, so a parser/format/transient
      // failure is never conflated with the model judging nothing mintable.
      drop(
        pr,
        'no-draft',
        // The boundary parse above + the "cause iff empty" refine guarantee
        // `noDraftCause` is present in this empty-drafts branch — assert it rather
        // than defend with a `?? 'unknown'` fallback that can never fire.
        `extractor produced no draft from a complete thread (cause: ${draftResult.noDraftCause!})`,
        draftResult.noDraftCause,
        sourceKind,
      );
      continue;
    }

    for (const body of draftBodies) {
      if (!isUsableDsl(body)) {
        drop(pr, 'unparseable', 'draft is empty or carries no usable **Pattern:**/yaml DSL');
        continue;
      }
      drafts.push({ provenance: provenance.value, dslSource: body, sourceKind });
    }
  }

  // Recompute the held-out-fetch count from the frozen split rather than trust a
  // self-declared label (fold 6): any logged fetch whose target is not in the
  // train slice is a violation. 0 by construction here.
  const heldOutFetchCount = apiEntries.filter((entry) => !trainSet.has(entry.targetPr)).length;

  return {
    drafts,
    dropLedger: { entries: dropEntries },
    apiUsageLedger: { entries: apiEntries, heldOutFetchCount },
    seedBlindness: { seedClassesProvided: deps.seedClassesProvided },
  };
}
