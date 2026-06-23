// ─── ADR-111 Stage-2 Classify (slice 3): DraftCandidate → CandidateRuleRecord ─
//
// The miner's deterministic Classify stage — the mint-time Tenet-9 Green/Yellow
// boundary (ADR-111 §4). It consumes slice-2's transient `DraftCandidate[]`, runs
// each through an injected `DraftClassifier` port (LLM-draft-only) to a
// `structural | behavioral` disposition, and MINTS the §3 `CandidateRuleRecord`
// (the miner's SOLE output) plus the §8 emission + classifier ledgers. `routing`
// is DERIVED from the disposition (never an input), so a behavioral candidate can
// never be compile-routed (FM(c)) by construction.
//
// ZERO real LLM lives here: the `DraftClassifier` is a port, mocked in tests (the
// #2188 mock-first discipline); the live LLM adapter rides a later slice. Core
// stays network-free + LLM-free + deterministic (the `Stage4VerifierDeps` DI
// pattern, as with `DraftExtractor`).
//
// ADR-111 boundaries this module enforces:
//   §3 sole output       — `CandidateRuleRecord` is the only emitted type, 1:1
//                          with the emission ledger; never `legitimacy`/`ruleClass`.
//   §4 classifier gate   — structural → compile-eligible, behavioral → RAG-only;
//                          the classifier output is a DRAFT (Tenet 15), Stage-4
//                          (slice 4) is the deterministic backstop.
//   §6 train-only        — Classify consumes in-memory drafts; NO GitHub fetch, no
//                          membership influence. A forged draft (provenance PR not
//                          in train, or a SHA ≠ the frozen merge commit) is a
//                          producer-integrity violation → FAIL LOUD (never a drop).
//   §7 seed-blindness    — the classifier has no seed channel by construction; the
//                          run-level fact is threaded from Extract and serialized
//                          into the emission ledger here (single home, Tenet 20).
//
// Safe-default (panel flag-5): on its own internal failure the adapter returns
// `{ disposition: 'behavioral', dispositionSource: 'error-default' }` — the
// low-privilege route (never compile), recorded as a DISTINCT counted state so the
// §8 done-criterion never conflates a flaky classifier with structural sparsity.

import { z } from 'zod';

import {
  type CandidateRuleRecord,
  CandidateRuleRecordSchema,
  type ClassifierDisposition,
  ClassifierDispositionSchema,
} from './candidate-rule.js';
import type { DraftCandidate, ExtractStageResult } from './extract.js';
import {
  type ClassifierLedger,
  ClassifierLedgerSchema,
  DispositionSourceSchema,
  type EmissionLedger,
  type EmissionLedgerEntry,
  EmissionLedgerSchema,
  type MinerLedgers,
  MinerLedgersSchema,
  type Routing,
  type SplitLedger,
} from './ledgers.js';

// ── Classifier port + its result ──────────────────────────────────────────────

/**
 * The classifier's verdict on one draft. `disposition` is the structural/behavioral
 * call; `dispositionSource` distinguishes a genuine judgment from the safe-default
 * on classifier failure (see below). Parsed at the core boundary (a non-enum value
 * from a buggy adapter fails loud here, BEFORE routing/mint).
 */
export const ClassifierResultSchema = z
  .object({
    disposition: ClassifierDispositionSchema,
    dispositionSource: DispositionSourceSchema,
  })
  .refine((v) => v.dispositionSource !== 'error-default' || v.disposition === 'behavioral', {
    // The safe-default is low-privilege BY DEFINITION: an `error-default` is always
    // `behavioral` (RAG-only), never compile-eligible. Enforce it structurally so a
    // buggy adapter returning `{ structural, error-default }` cannot reach
    // `dispositionToRouting` and compile-route a failure default (Tenet 15 > prose).
    message:
      "dispositionSource 'error-default' requires disposition 'behavioral' — the safe-default is always low-privilege (RAG-only), never compile-eligible",
    path: ['disposition'],
  });
export type ClassifierResult = z.infer<typeof ClassifierResultSchema>;

/**
 * Injected draft-classifier port (ADR-111 §4). Core-defined, CLI-implemented —
 * the live LLM lives behind this at the CLI layer (draft-only, Tenet-15); a
 * deterministic fixture impl drives tests. The miner is BLIND to seed classes
 * (§7 / FM(f)): the port is handed ONLY a slice-2 `DraftCandidate` (provenance +
 * dslSource) — the signature itself carries no seed channel (the structural
 * backstop; the emission-ledger attestation is its CI-observable witness).
 *
 * Error contract (mirrors `DraftExtractor`'s `[]`-on-failure): on its own
 * internal/transient failure (LLM/network), the adapter catches it and returns
 * the SAFE DEFAULT `{ disposition: 'behavioral', dispositionSource: 'error-default' }`
 * — the conservative low-privilege route (RAG-only, never compile; Tenet 9),
 * Stage-4-backstopped. It MUST NOT throw for a per-candidate failure; a
 * contract-violating throw propagates loudly (core adds no swallowing catch —
 * Tenet 4).
 */
export interface DraftClassifier {
  classify(draft: DraftCandidate): Promise<ClassifierResult>;
}

/** Dependencies for a single Classify-stage run. */
export interface ClassifyStageDeps {
  classifier: DraftClassifier;
}

/** The Classify stage's output: the minted candidates + the two ledgers Classify owns. */
export interface ClassifyStageResult {
  /** The miner's SOLE output (ADR-111 §3); 1:1 with `emissionLedger.entries`. */
  candidates: CandidateRuleRecord[];
  /** Emission ledger — per-candidate routing + the run-level seed-blindness attestation (§8 / FM f). */
  emissionLedger: EmissionLedger;
  /** Classifier ledger — structural/behavioral split + Stage-4 confirmation + disposition source (§8). */
  classifierLedger: ClassifierLedger;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Derive routing from the classifier disposition — the ONLY place routing is set,
 * never accepted as caller input, so emission `routing`, emission
 * `classifierDisposition`, and the classifier-ledger `disposition` can never drift
 * (the desync FM(c) guards against). Exhaustive over the 2-value enum.
 */
export function dispositionToRouting(disposition: ClassifierDisposition): Routing {
  return disposition === 'structural' ? 'compile' : 'rag-only';
}

function assertUniqueRefs(refs: string[], label: string): void {
  if (new Set(refs).size !== refs.length) {
    // Deterministic per-(pr, ordinal) refs are unique by construction; a collision
    // would collapse the harness's classifier-join Map and hide an integrity bug.
    throw new Error(`[Totem Error] runClassifyStage: duplicate ${label} refs in [${refs}]`);
  }
}

// ── The Classify stage ─────────────────────────────────────────────────────────

/**
 * Run the deterministic Stage-2 Classify over slice-2's Extract output against the
 * frozen split ledger. Deterministic given its deps: identical drafts + a fixed
 * classifier → identical candidates, refs, and ledgers (drafts are classified
 * SEQUENTIALLY, so ordinal assignment + ledger order follow the stable input order).
 *
 * Per draft (in input order): re-validate provenance against the frozen split
 * (fail loud on a forged draft — never a drop) → classify (parse the result at the
 * boundary) → derive routing → mint the `CandidateRuleRecord` → record one emission
 * + one classifier ledger row. Drafts are NEVER de-duplicated (duplicate `dslSource`
 * → distinct candidates with distinct refs); any dedup is a downstream concern.
 *
 * @throws if a draft's provenance PR is not in the frozen train slice, or its
 * `commitSha` ≠ that PR's frozen merge commit (producer-integrity violation), if
 * the classifier returns a non-enum result, or if the 1:1/uniqueness invariants
 * break — all fail-loud (Tenet 4), distinct from a content drop (Extract-only).
 */
export async function runClassifyStage(
  extract: ExtractStageResult,
  splitLedger: SplitLedger,
  deps: ClassifyStageDeps,
): Promise<ClassifyStageResult> {
  const trainSet = new Set(splitLedger.split.trainPrs);
  const mergeCommitByPr = new Map(
    splitLedger.corpusMergeCommits.map(({ pr, mergeCommit }) => [pr, mergeCommit]),
  );

  const candidates: CandidateRuleRecord[] = [];
  const emissionEntries: EmissionLedgerEntry[] = [];
  const classifierEntries: ClassifierLedger['entries'] = [];
  // Per-PR ordinal so N drafts from one PR get distinct, deterministic refs.
  const ordinalByPr = new Map<number, number>();

  for (const draft of extract.drafts) {
    const pr = draft.provenance.mergedPr;

    // §6 producer-integrity re-check: a draft must be sourced from a TRAIN PR with
    // the PR's frozen merge commit. Carry-verbatim from a trusted `runExtractStage`
    // guarantees this, but re-checking keeps the stage honest even if a future
    // caller hands in drafts that bypassed Extract. A forged draft is a contract
    // violation → FAIL LOUD, never a drop (drops are content failures, Extract-only).
    if (!trainSet.has(pr)) {
      throw new Error(
        `[Totem Error] runClassifyStage: draft provenance PR #${pr} is not in the frozen train slice — a forged/leaked draft (FM(e-emission))`,
      );
    }
    const expectedSha = mergeCommitByPr.get(pr);
    if (expectedSha === undefined) {
      throw new Error(
        `[Totem Error] runClassifyStage: split ledger has no frozen merge commit for train PR #${pr}`,
      );
    }
    if (draft.provenance.commitSha !== expectedSha) {
      throw new Error(
        `[Totem Error] runClassifyStage: draft provenance commitSha for PR #${pr} does not match the frozen merge commit (FM(e-emission))`,
      );
    }

    const ordinal = ordinalByPr.get(pr) ?? 0;
    ordinalByPr.set(pr, ordinal + 1);
    const candidateRef = `cand-${pr}-${ordinal}`;
    const classifierLedgerRef = `clr-${pr}-${ordinal}`;

    // Classify (LLM-draft via the port), then PARSE the result at the boundary: a
    // non-enum disposition/source from a buggy adapter fails loud HERE, before
    // routing or mint (so "non-enum is unconstructible" actually holds).
    const result = ClassifierResultSchema.parse(await deps.classifier.classify(draft));
    const routing = dispositionToRouting(result.disposition);

    // Mint the §3 envelope through its schema (forces `unverified: true`, non-empty
    // refs/dslSource; provenance + dslSource carried byte-verbatim from the draft).
    const candidate = CandidateRuleRecordSchema.parse({
      provenance: draft.provenance,
      classifierDisposition: result.disposition,
      classifierLedgerRef,
      dslSource: draft.dslSource,
      unverified: true,
    });
    candidates.push(candidate);

    emissionEntries.push({
      candidateRef,
      provenance: draft.provenance,
      classifierDisposition: result.disposition,
      routing,
      classifierLedgerRef,
      unverified: true,
      // Carry the slice-β substrate provenance from the draft onto its §8 emission
      // row (panel OQ-β4 — the emission ledger is its persisted home, single hop).
      sourceKind: draft.sourceKind,
    });
    classifierEntries.push({
      // The classifier entry's own ref = the join key the emission entry points to.
      candidateRef: classifierLedgerRef,
      disposition: result.disposition,
      // Stage-4 is wired in slice 4; the disposition is a DRAFT until then (Tenet 15).
      stage4Confirmed: false,
      dispositionSource: result.dispositionSource,
    });
  }

  // 1:1 invariant (FM(i) is PR-level and cannot catch a silently-skipped DRAFT):
  // every input draft produced exactly one candidate + one emission + one classifier
  // row. By construction here; asserted so a future edit can't silently break it.
  if (
    candidates.length !== extract.drafts.length ||
    emissionEntries.length !== extract.drafts.length ||
    classifierEntries.length !== extract.drafts.length
  ) {
    throw new Error(
      `[Totem Error] runClassifyStage: 1:1 invariant violated (drafts=${extract.drafts.length}, candidates=${candidates.length}, emission=${emissionEntries.length}, classifier=${classifierEntries.length})`,
    );
  }
  assertUniqueRefs(
    emissionEntries.map((e) => e.candidateRef),
    'candidateRef',
  );
  assertUniqueRefs(
    classifierEntries.map((c) => c.candidateRef),
    'classifierLedgerRef',
  );

  // Serialize the run-level seed-blindness fact (established at Extract, §7) into
  // the emission ledger — its single persisted home (Tenet 20 / slice-2 fold 8).
  const emissionLedger = EmissionLedgerSchema.parse({
    entries: emissionEntries,
    extractionInputsAttestation: {
      seedClassesProvided: extract.seedBlindness.seedClassesProvided,
    },
  });
  const classifierLedger = ClassifierLedgerSchema.parse({ entries: classifierEntries });

  return { candidates, emissionLedger, classifierLedger };
}

/**
 * Combine the five §8 ledgers into the harness's `MinerLedgers` — a thin, pure
 * struct assembly (no orchestration; the fetch→extract→classify DRIVING is slice
 * 5). Lets the §8 falsification harness run end-to-end on REAL producer output
 * now: split (slice 1) + drop/apiUsage (slice 2 Extract) + emission/classifier
 * (slice 3 Classify). The schema parse validates the combined shape.
 */
export function assembleMinerLedgers(
  splitLedger: SplitLedger,
  extract: ExtractStageResult,
  classify: ClassifyStageResult,
): MinerLedgers {
  return MinerLedgersSchema.parse({
    emission: classify.emissionLedger,
    drop: extract.dropLedger,
    classifier: classify.classifierLedger,
    split: splitLedger,
    apiUsage: extract.apiUsageLedger,
  });
}
