// ─── ADR-111 Stage-1 Extract (slice 2): review-thread → draft DSL ────────────
//
// The miner's deterministic Extract stage. It iterates the frozen split's TRAIN
// slice ONLY, fetches each PR's review thread through an injected port, runs a
// completeness check (≥1 HUMAN review comment), drafts zero-or-more
// lesson-markdown DSL bodies through an injected `DraftExtractor` port, and
// either carries a transient `DraftCandidate` or loud-drops to the drop ledger
// with a reason code. It writes the drop + API-usage ledgers and the in-run
// seed-blindness fact.
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

import { type ProvenanceRecord, ProvenanceRecordSchema } from '../compiler-schema.js';
import { extractManualPattern } from '../lesson-pattern.js';
import type {
  ApiUsageLedger,
  ApiUsageLedgerEntry,
  DropLedger,
  DropLedgerEntry,
  DropReasonCode,
} from './ledgers.js';
import { isBotIdentity } from './selection-rule.js';
import type { SplitArtifact } from './split.js';

// ── Parsed review-thread content (the fetch port's payload) ───────────────────

/** A single parsed review-thread comment (provider-neutral; mirrors the CLI `groupIntoThreads` shape). */
export interface ReviewThreadComment {
  author: string;
  body: string;
}

/** A single review thread on a file path. */
export interface ReviewThread {
  path: string;
  comments: ReviewThreadComment[];
}

/**
 * The CONTENT side of a train PR, returned by the injected `ReviewThreadSource`.
 * Content-only (ADR-111 §6): it never influences corpus membership / the split /
 * control selection — the offline `selectionRule` is the sole membership oracle.
 */
export interface ReviewThreadContent {
  pr: number;
  /** Lowercase 40-hex merge-commit SHA — becomes the candidate's `provenance.commitSha`. */
  headCommitSha: string;
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
}

// ── Injected ports (core-defined, CLI-implemented — the Stage4VerifierDeps DI) ─

/**
 * Injected review-thread fetch port (ADR-111 §6 content-only). Core-defined,
 * CLI-implemented — keeps core network-free. MUST be called for train PRs only;
 * the orchestrator guarantees that by iterating the train slice.
 */
export interface ReviewThreadSource {
  fetch(pr: number): FetchResult;
}

/**
 * Injected draft-DSL extractor port. List-shaped (fold 1): one thread can carry
 * multiple structural invariants, so it returns ZERO-or-more draft bodies. The
 * LLM lives behind this at the CLI layer (draft-only, Tenet-15); a deterministic
 * fixture impl drives tests. The miner is BLIND to seed classes (§7 / FM f): the
 * port is never handed one.
 */
export interface DraftExtractor {
  draft(content: ReviewThreadContent): string[];
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
 * Count HUMAN review comments (fold 5): bot comments (CodeRabbit / Greptile /
 * Renovate / dependabot, via the shared `isBotIdentity`) and empty/whitespace
 * bodies do NOT count toward §6's "≥1 review comment" threshold — a bot-only or
 * empty thread is content-thin and must take the loud-drop path, never seed a
 * hallucinated draft.
 */
function humanCommentCount(content: ReviewThreadContent): number {
  let count = 0;
  for (const thread of content.threads) {
    for (const comment of thread.comments) {
      if (comment.body.trim().length > 0 && !isBotIdentity(comment.author)) count++;
    }
  }
  return count;
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
  } catch {
    return false;
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
    commitSha: content.headCommitSha,
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
 * Run the deterministic Stage-1 Extract over a frozen split. Pure given its
 * deps: identical `split` + deps → identical drafts, drops, and ledgers. The
 * live LLM and GitHub IO are injected ports, so this orchestration is fully
 * CI-locked with a fixture extractor + a strict-spy fetch source.
 *
 * Per train PR (and ONLY train PRs): log the fetch → fetch → on unreachable /
 * unparseable-at-source, loud-drop → completeness-check (≥1 human comment) →
 * build provenance → draft zero-or-more bodies → preflight each → carry a
 * `DraftCandidate` or loud-drop. Every train PR ends with at least one draft or
 * one drop (FM i, slice-2 half).
 */
export function runExtractStage(split: SplitArtifact, deps: ExtractStageDeps): ExtractStageResult {
  const trainSet = new Set(split.trainPrs);
  const drafts: DraftCandidate[] = [];
  const dropEntries: DropLedgerEntry[] = [];
  const apiEntries: ApiUsageLedgerEntry[] = [];

  const drop = (sourcePr: number, reasonCode: DropReasonCode, detail: string): void => {
    dropEntries.push({ sourcePr, reasonCode, detail });
  };

  // Iterate the TRAIN slice ONLY — held-out / control / excluded PRs are never
  // fetched (§6 / FM h). Deterministic ascending order.
  const trainPrs = [...trainSet].sort((a, b) => a - b);

  for (const pr of trainPrs) {
    // Every attempted content fetch is logged as a train-slice fetch (the audit
    // surface FM h reads). We only ever target train PRs, so this is always
    // `slice: 'train'`.
    apiEntries.push({ targetPr: pr, slice: 'train', fetchKind: 'review-thread' });

    const result = deps.source.fetch(pr);
    if (result.kind === 'unreachable') {
      drop(pr, 'unreachable', result.detail ?? `review thread unreachable for train PR #${pr}`);
      continue;
    }
    if (result.kind === 'unparseable') {
      drop(pr, 'unparseable', result.detail ?? `review thread unparseable for train PR #${pr}`);
      continue;
    }
    const content = result.content;

    // Completeness (§6): ≥1 HUMAN review comment, non-empty.
    if (humanCommentCount(content) < 1) {
      drop(pr, 'truncated', 'no non-empty human review comment after bot filtering');
      continue;
    }

    // Provenance must be complete or the PR is dropped, never partial (FM a).
    const provenance = buildProvenance(pr, content);
    if (!provenance.ok) {
      drop(pr, 'incomplete-provenance', provenance.reason);
      continue;
    }

    // Draft zero-or-more DSL bodies (fold 1, list-shaped). A thrown extractor is
    // a loud per-PR drop, not a run abort (Tenet 4: loud, recorded, continue).
    let draftBodies: string[];
    try {
      draftBodies = deps.extractor.draft(content);
    } catch (err) {
      drop(
        pr,
        'unparseable',
        `extractor threw: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    if (draftBodies.length === 0) {
      // A complete thread that yields no draft is a loud drop (keeps the train PR
      // creditable under FM i), not a silent skip.
      drop(pr, 'unparseable', 'extractor produced no draft from a complete thread');
      continue;
    }

    for (const body of draftBodies) {
      if (!isUsableDsl(body)) {
        drop(pr, 'unparseable', 'draft is empty or carries no usable **Pattern:**/yaml DSL');
        continue;
      }
      drafts.push({ provenance: provenance.value, dslSource: body });
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
