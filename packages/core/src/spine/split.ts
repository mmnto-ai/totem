// ─── ADR-111 §5 Gate-1 train/test split — frozen, ancestry-ordered ──────────
//
// The mining/control split over the frozen corpus `selectionRule(asOfCommit)`
// (ADR-110 §6). Committed as a lock BEFORE extraction; `trainPrs` = the OLDER
// ancestry segment (mining), `heldOutPrs` = the NEWER held-out segment
// (control) — forward-chronological, never a random shuffle (reverse-causality
// leakage) and never commit-date (rebase-rewritable; the same `--topo-order`
// invariant as #2197). The split is a THREE-WAY DISJOINT COVER of the corpus:
// `trainPrs ⊎ heldOutPrs ⊎ excludedPrs == selectionRule(asOfCommit)`, with the
// positive/negative controls as designated tags WITHIN `heldOutPrs` (never a
// separate cover bucket). Total accounting (FM (d)/(g)): a corpus PR in no slice
// is a silent drop; a slice PR outside the corpus is an out-of-corpus member.
//
// This module is the pure schema + the deterministic cover validator (the §8
// split-ledger check) + the forward-ancestry-cut producer. IO (git enumeration
// → PrMeta) lives in the cli layer, as with `selection-rule.ts`.

import { z } from 'zod';

import { diffPrSets, type PrMeta, type PrSetDiff } from './selection-rule.js';

/** Lowercase 40-hex git commit SHA — canonical git form (cf. compiler-schema `COMMIT_SHA_RE`). */
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;

const PrNumber = z.number().int().positive();

/**
 * ADR-111 §5 — the frozen split artifact, committed before extraction. The
 * concrete `cutIndex` is the deferred window-open scalar (Deferred Decisions);
 * the field is required in the committed artifact, only its value is deferred.
 */
export const SplitArtifactSchema = z.object({
  asOfCommit: z.string().regex(COMMIT_SHA_RE),
  /** The OLDER ancestry segment — the mining slice. */
  trainPrs: z.array(PrNumber),
  /** The NEWER held-out segment — control evaluation. Controls are tags within this. */
  heldOutPrs: z.array(PrNumber),
  /** Explicitly enumerated drops (the atomic revert pairs). */
  excludedPrs: z.array(PrNumber),
  /** Positive controls — a designated subset (tag) of `heldOutPrs`, never a separate cover bucket. */
  positiveControlPrs: z.array(PrNumber),
  /** Negative controls — a designated subset (tag) of `heldOutPrs`. */
  negativeControlPrs: z.array(PrNumber),
  splitRule: z.object({
    /** Human-readable predicate expression that generated the corpus (mirrors the windtunnel lock's `selectionRule.predicate`). */
    predicate: z.string().refine((s) => s.trim().length > 0, {
      message: 'splitRule.predicate must be a non-empty expression',
    }),
    /**
     * Forward-chronological ancestry cut: `trainPrs` = the `cutIndex` OLDEST
     * corpus PRs (ancestry order), `heldOutPrs` = the newer remainder. Concrete
     * value deferred to window-open (ADR-111 Deferred Decisions).
     */
    cutIndex: z.number().int().nonnegative(),
  }),
});

export type SplitArtifact = z.infer<typeof SplitArtifactSchema>;

/** Thrown when `resolveSplit` cannot produce a clean three-way disjoint cover (Tenet 4, fail-loud). */
export class SplitCoverError extends Error {
  constructor(public readonly result: SplitCoverResult) {
    super(
      `split is not a valid disjoint cover of selectionRule(asOfCommit): ${summarizeCover(result)}`,
    );
    this.name = 'SplitCoverError';
  }
}

/** Structured result of the §5/§8 split-ledger mechanical check. `ok` iff every diagnostic list is empty. */
export interface SplitCoverResult {
  ok: boolean;
  /**
   * Cover vs the frozen corpus, direction-disambiguated so each side falsifies
   * its own clause: `missing` = a corpus PR assigned to no slice (FM(g), silent
   * drop); `extra` = a slice PR outside the corpus (FM(d), out-of-corpus member).
   */
  cover: PrSetDiff;
  /** Pairwise PR# intersections of {train, heldOut, excluded} that must be empty (the `⊎` disjointness). */
  overlaps: { trainHeldOut: number[]; trainExcluded: number[]; heldOutExcluded: number[] };
  /** Control PRs not contained in `heldOutPrs` — controls must be tags WITHIN heldOut, not a separate bucket. */
  controlsOutsideHeldOut: number[];
  /** PRs tagged as BOTH a positive and a negative control — a PR cannot be both (per-rule control coherence). */
  controlOverlap: number[];
  /** Merge-commit SHAs appearing in more than one slice — disjoint by merge-commit, not only PR# (revert/target straddle guard). */
  mergeCommitCollisions: string[];
}

function uniqueSorted(xs: number[]): number[] {
  return [...new Set(xs)].sort((a, b) => a - b);
}

function intersect(a: number[], b: number[]): number[] {
  const bs = new Set(b);
  return uniqueSorted(a.filter((x) => bs.has(x)));
}

function summarizeCover(r: SplitCoverResult): string {
  const parts: string[] = [];
  if (r.cover.missing.length) parts.push(`missing(FM-g)=[${r.cover.missing}]`);
  if (r.cover.extra.length) parts.push(`extra(FM-d)=[${r.cover.extra}]`);
  if (r.overlaps.trainHeldOut.length) parts.push(`train∩heldOut=[${r.overlaps.trainHeldOut}]`);
  if (r.overlaps.trainExcluded.length) parts.push(`train∩excluded=[${r.overlaps.trainExcluded}]`);
  if (r.overlaps.heldOutExcluded.length)
    parts.push(`heldOut∩excluded=[${r.overlaps.heldOutExcluded}]`);
  if (r.controlsOutsideHeldOut.length) parts.push(`controls⊄heldOut=[${r.controlsOutsideHeldOut}]`);
  if (r.controlOverlap.length) parts.push(`pos∩neg=[${r.controlOverlap}]`);
  if (r.mergeCommitCollisions.length)
    parts.push(`mergeCommitCollisions=[${r.mergeCommitCollisions}]`);
  return parts.join(' ');
}

/**
 * The §8 split-ledger check: verifies the split is a three-way disjoint cover of
 * `corpus` (= `selectionRule(asOfCommit)`), that the controls are tags within
 * `heldOutPrs`, and that the slices are disjoint by merge-commit (not only PR#).
 * Pure; the harness asserts `ok` and reads the per-field diffs to pin the exact
 * Falsifying-Metric clause (FM(d) extra / FM(g) missing).
 */
export function validateSplitCover(
  split: SplitArtifact,
  corpus: number[],
  mergeCommitByPr: ReadonlyMap<number, string>,
): SplitCoverResult {
  const union = [...split.trainPrs, ...split.heldOutPrs, ...split.excludedPrs];
  const cover = diffPrSets(corpus, union); // missing ⇒ FM(g), extra ⇒ FM(d)

  const overlaps = {
    trainHeldOut: intersect(split.trainPrs, split.heldOutPrs),
    trainExcluded: intersect(split.trainPrs, split.excludedPrs),
    heldOutExcluded: intersect(split.heldOutPrs, split.excludedPrs),
  };

  const heldOutSet = new Set(split.heldOutPrs);
  const controlsOutsideHeldOut = uniqueSorted(
    [...split.positiveControlPrs, ...split.negativeControlPrs].filter((pr) => !heldOutSet.has(pr)),
  );

  const controlOverlap = intersect(split.positiveControlPrs, split.negativeControlPrs);
  const mergeCommitCollisions = mergeCommitCollisionsAcrossSlices(split, mergeCommitByPr);

  const ok =
    cover.missing.length === 0 &&
    cover.extra.length === 0 &&
    overlaps.trainHeldOut.length === 0 &&
    overlaps.trainExcluded.length === 0 &&
    overlaps.heldOutExcluded.length === 0 &&
    controlsOutsideHeldOut.length === 0 &&
    controlOverlap.length === 0 &&
    mergeCommitCollisions.length === 0;

  return { ok, cover, overlaps, controlsOutsideHeldOut, controlOverlap, mergeCommitCollisions };
}

/** SHAs whose owning PRs land in >1 slice. With 1:1 PR→SHA this also catches a malformed straddle. */
function mergeCommitCollisionsAcrossSlices(
  split: SplitArtifact,
  mergeCommitByPr: ReadonlyMap<number, string>,
): string[] {
  const slices: number[][] = [split.trainPrs, split.heldOutPrs, split.excludedPrs];
  const shaSliceCount = new Map<string, number>();
  for (const slice of slices) {
    const shasInSlice = new Set<string>();
    for (const pr of slice) {
      const sha = mergeCommitByPr.get(pr);
      if (sha !== undefined) shasInSlice.add(sha);
    }
    for (const sha of shasInSlice) shaSliceCount.set(sha, (shaSliceCount.get(sha) ?? 0) + 1);
  }
  return [...shaSliceCount.entries()]
    .filter(([, n]) => n > 1)
    .map(([sha]) => sha)
    .sort();
}

/**
 * Produce a frozen split from the resolved corpus by the forward-chronological
 * ancestry cut. `corpus` is `selectionRule(asOfCommit)` (the cover base);
 * `orderedNewestFirst` is the same ancestry enumeration `resolveSelectionRule`
 * consumes (`git log --topo-order`, newest-first) and MUST cover the corpus.
 * `excludedPrs` (the atomic revert pairs) are removed from train/heldOut but
 * remain in the cover. Validates the result and throws `SplitCoverError` on any
 * cover/disjointness violation (Tenet 4) — a malformed split never freezes.
 *
 * NOTE (open integration detail, flagged to strategy-claude): how `excludedPrs`
 * (revert pairs) reconcile with `selectionRule`'s own `excludeRevertPairs`
 * (which drops them from its output) determines whether the `corpus` cover base
 * includes reverts. This producer is agnostic — it takes `corpus` + `excludedPrs`
 * as given; the caller resolves them consistently. The validator above is
 * correct either way.
 */
export function resolveSplit(params: {
  asOfCommit: string;
  corpus: number[];
  orderedNewestFirst: number[];
  excludedPrs: number[];
  cutIndex: number;
  positiveControlPrs?: number[];
  negativeControlPrs?: number[];
  predicate: string;
  mergeCommitByPr: ReadonlyMap<number, string>;
}): SplitArtifact {
  const corpusSet = new Set(params.corpus);
  const excludedSet = new Set(params.excludedPrs);

  // Corpus PRs in ancestry order, newest-first, deduped — then reversed to oldest-first.
  const seen = new Set<number>();
  const newestFirstCorpus: number[] = [];
  for (const pr of params.orderedNewestFirst) {
    if (!corpusSet.has(pr) || seen.has(pr)) continue;
    seen.add(pr);
    newestFirstCorpus.push(pr);
  }
  const ordering = diffPrSets(params.corpus, newestFirstCorpus);
  if (ordering.missing.length > 0) {
    throw new Error(
      `resolveSplit: orderedNewestFirst does not cover the corpus (missing ancestry order for [${ordering.missing}])`,
    );
  }

  const oldestFirstNonExcluded = [...newestFirstCorpus]
    .reverse()
    .filter((pr) => !excludedSet.has(pr));
  const trainPrs = uniqueSorted(oldestFirstNonExcluded.slice(0, params.cutIndex));
  const heldOutPrs = uniqueSorted(oldestFirstNonExcluded.slice(params.cutIndex));

  const split = SplitArtifactSchema.parse({
    asOfCommit: params.asOfCommit,
    trainPrs,
    heldOutPrs,
    excludedPrs: uniqueSorted(params.excludedPrs),
    positiveControlPrs: uniqueSorted(params.positiveControlPrs ?? []),
    negativeControlPrs: uniqueSorted(params.negativeControlPrs ?? []),
    splitRule: { predicate: params.predicate, cutIndex: params.cutIndex },
  });

  const validation = validateSplitCover(split, params.corpus, params.mergeCommitByPr);
  if (!validation.ok) throw new SplitCoverError(validation);
  return split;
}

/** Re-export for callers building the `mergeCommitByPr` map from enumerated metas. */
export function mergeCommitMap(metas: PrMeta[]): Map<number, string> {
  return new Map(metas.map((m) => [m.pr, m.mergeCommit]));
}
