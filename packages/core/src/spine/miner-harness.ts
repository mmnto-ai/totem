// ─── ADR-111 §8 Gate-1 falsification harness — zero-LLM, CI-observable ───────
//
// Asserts the nine Falsifying-Metric clauses (a)–(i) against the five execution
// ledgers (§8) + the split cover validator. Pure + deterministic; runs in
// `totem lint` / the test suite. The miner run is contract-clean iff `ok` (no
// clause holds). Clause (e) has two halves: `e-split` (slice disjointness, from
// the cover validator) and `e-emission` (∀ emitted: `provenance.mergedPr ∈
// trainPrs`) — split-disjointness is necessary-not-sufficient (a candidate can
// be sourced from a held-out PR even with perfectly disjoint slices).

import { type MinerLedgers, MinerLedgersSchema } from './ledgers.js';
import { validateSplitCover } from './split.js';

export type FmClause =
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e-split'
  | 'e-emission'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  // NOT a Falsifying-Metric letter (a–i are unchanged). A done-criterion
  // CONSISTENCY guard (slice 4): the compile/Stage-4 outcome recorded on a
  // classifier entry must agree with its `stage4Confirmed` boolean.
  | 'stage4-consistency'
  | 'schema';

export interface FmViolation {
  clause: FmClause;
  detail: string;
}

export interface FalsificationResult {
  /** true iff NO Falsifying-Metric clause holds (the miner run is contract-clean). */
  ok: boolean;
  violations: FmViolation[];
}

/**
 * Run the §8 falsification harness over raw (untrusted) ledger JSON. The schema
 * parse is the first gate — an incomplete provenance tuple (FM(a)) or a
 * non-`unverified` mint (FM(b)) cannot construct a valid `MinerLedgers`, so a
 * parse failure is mapped to its clause. Surviving ledgers then run the
 * cross-cutting checks (c, d, e-split, e-emission, f, g, h, i).
 */
export function runFalsificationHarness(rawLedgers: unknown): FalsificationResult {
  const parsed = MinerLedgersSchema.safeParse(rawLedgers);
  if (!parsed.success) {
    return { ok: false, violations: parsed.error.issues.map(mapZodIssueToClause) };
  }
  const violations = checkParsedLedgers(parsed.data);
  return { ok: violations.length === 0, violations };
}

/**
 * Cross-cutting checks over an ALREADY-VALIDATED `MinerLedgers`.
 *
 * ⚠ FM(a) (incomplete provenance) and FM(b) (non-`unverified` mint) are
 * SCHEMA-ENFORCED and are NOT re-asserted here — a caller that hands in an
 * in-process `MinerLedgers` gets no FM(a)/(b) coverage from this function. For
 * untrusted/raw ledger JSON use {@link runFalsificationHarness}, which parses
 * (catching FM(a)/(b)) before delegating here.
 */
export function checkParsedLedgers(ledgers: MinerLedgers): FmViolation[] {
  const violations: FmViolation[] = [];
  checkClassifierRouting(ledgers, violations); // (c)
  checkStage4Consistency(ledgers, violations); // (consistency, not an FM letter)
  checkSplitCover(ledgers, violations); // (d) / (g) / (e-split)
  checkEmissionMembership(ledgers, violations); // (e-emission)
  checkSeedBlindness(ledgers, violations); // (f)
  checkApiUsage(ledgers, violations); // (h)
  checkTrainCoverage(ledgers, violations); // (i)
  return violations;
}

// Map a Zod parse failure to its FM clause by a SEGMENT match on the issue path:
// a `provenance` segment ⇒ FM(a) (incomplete tuple), an `unverified` segment ⇒
// FM(b) (non-Yellow mint). Segment-level (not a substring on the joined path) so
// a future field like `classifierProvenanceRef` can't masquerade as `provenance`.
function mapZodIssueToClause(issue: { path: (string | number)[]; message: string }): FmViolation {
  const segments = issue.path.map(String);
  const clause: FmClause = segments.includes('unverified')
    ? 'b'
    : segments.includes('provenance')
      ? 'a'
      : 'schema';
  return { clause, detail: `${segments.join('.') || '<root>'}: ${issue.message}` };
}

// (c) — a behavioral candidate must never reach compile, and every emitted
// candidate must carry an attesting classifier-ledger entry.
function checkClassifierRouting(ledgers: MinerLedgers, out: FmViolation[]): void {
  const classifierByRef = new Map(ledgers.classifier.entries.map((c) => [c.candidateRef, c]));
  for (const e of ledgers.emission.entries) {
    if (e.classifierDisposition === 'behavioral' && e.routing === 'compile') {
      out.push({
        clause: 'c',
        detail: `candidate ${e.candidateRef}: behavioral candidate routed to compile`,
      });
    }
    const attesting = classifierByRef.get(e.classifierLedgerRef);
    if (attesting === undefined) {
      out.push({
        clause: 'c',
        detail: `candidate ${e.candidateRef}: no classifier-ledger entry for ref '${e.classifierLedgerRef}'`,
      });
    } else if (e.classifierDisposition !== attesting.disposition) {
      // The two ledgers disagree on this candidate's class — a producer integrity bug.
      out.push({
        clause: 'c',
        detail: `candidate ${e.candidateRef}: emission disposition '${e.classifierDisposition}' does not match classifier-ledger disposition '${attesting.disposition}'`,
      });
    } else if (e.routing === 'compile' && attesting.disposition === 'behavioral') {
      out.push({
        clause: 'c',
        detail: `candidate ${e.candidateRef}: compile-routed but classifier ledger attests behavioral`,
      });
    }
  }
}

// (consistency, NOT an FM letter) — the compile/Stage-4 outcome recorded on a
// classifier entry must agree with its `stage4Confirmed` boolean. By construction
// `runCompileStage`'s atomic outcome→{status, stage4Confirmed, stage4Outcome} map
// makes desync unreachable; this locks it anyway (symmetric to FM(c)'s by-
// construction check). `confirmed` ⟺ `stage4Confirmed:true`; the three inert
// outcomes ⟺ `false`; an entry with NO recorded outcome can never be confirmed
// (nothing produced the evidence — e.g. a behavioral/rag-only or pre-compile entry).
// Per the panel (strategy/codex/gemini flag-5 shape) this is a done-criterion guard,
// NOT a new lettered Falsifying-Metric clause — a–i are unchanged.
function checkStage4Consistency(ledgers: MinerLedgers, out: FmViolation[]): void {
  for (const c of ledgers.classifier.entries) {
    if (c.stage4Outcome === undefined) {
      if (c.stage4Confirmed) {
        out.push({
          clause: 'stage4-consistency',
          detail: `classifier entry ${c.candidateRef}: stage4Confirmed is true but no stage4Outcome was recorded`,
        });
      }
      continue;
    }
    const confirmedByOutcome = c.stage4Outcome === 'confirmed';
    if (c.stage4Confirmed !== confirmedByOutcome) {
      out.push({
        clause: 'stage4-consistency',
        detail: `classifier entry ${c.candidateRef}: stage4Confirmed=${c.stage4Confirmed} is inconsistent with stage4Outcome='${c.stage4Outcome}'`,
      });
    }
  }
}

// (d) extra / (g) missing / (e-split) disjointness — via the cover validator.
function checkSplitCover(ledgers: MinerLedgers, out: FmViolation[]): void {
  const { split, corpus, corpusMergeCommits } = ledgers.split;
  const mergeCommitByPr = new Map(
    corpusMergeCommits.map(({ pr, mergeCommit }) => [pr, mergeCommit]),
  );
  const r = validateSplitCover(split, corpus, mergeCommitByPr);
  if (r.cover.extra.length > 0) {
    out.push({ clause: 'd', detail: `out-of-corpus split members: [${r.cover.extra}]` });
  }
  if (r.cover.missing.length > 0) {
    out.push({ clause: 'g', detail: `corpus PRs in no slice (silent drop): [${r.cover.missing}]` });
  }
  const splitDisjointness =
    r.overlaps.trainHeldOut.length +
    r.overlaps.trainExcluded.length +
    r.overlaps.heldOutExcluded.length +
    r.controlsOutsideHeldOut.length +
    r.controlOverlap.length +
    r.mergeCommitCollisions.length;
  if (splitDisjointness > 0) {
    out.push({
      clause: 'e-split',
      detail:
        `slice disjointness violated — train∩heldOut=[${r.overlaps.trainHeldOut}] ` +
        `train∩excluded=[${r.overlaps.trainExcluded}] heldOut∩excluded=[${r.overlaps.heldOutExcluded}] ` +
        `controls⊄heldOut=[${r.controlsOutsideHeldOut}] pos∩neg=[${r.controlOverlap}] ` +
        `mergeCommitCollisions=[${r.mergeCommitCollisions}]`,
    });
  }
}

// (e-emission) — every emitted candidate's provenance PR must be in the train slice.
function checkEmissionMembership(ledgers: MinerLedgers, out: FmViolation[]): void {
  const trainSet = new Set(ledgers.split.split.trainPrs);
  const mergeCommitByPr = new Map(
    ledgers.split.corpusMergeCommits.map(({ pr, mergeCommit }) => [pr, mergeCommit]),
  );
  for (const e of ledgers.emission.entries) {
    if (!trainSet.has(e.provenance.mergedPr)) {
      out.push({
        clause: 'e-emission',
        detail: `candidate ${e.candidateRef}: provenance PR ${e.provenance.mergedPr} is not in the train slice`,
      });
      continue;
    }
    // The provenance commit SHA must be the PR's frozen merge commit — a tuple
    // carrying an arbitrary (or another PR's) SHA is provenance in name only.
    const expectedSha = mergeCommitByPr.get(e.provenance.mergedPr);
    if (expectedSha !== undefined && e.provenance.commitSha !== expectedSha) {
      out.push({
        clause: 'e-emission',
        detail: `candidate ${e.candidateRef}: provenance commitSha does not match PR ${e.provenance.mergedPr}'s frozen merge commit`,
      });
    }
  }
}

// (f) — seed-blindness attestation.
function checkSeedBlindness(ledgers: MinerLedgers, out: FmViolation[]): void {
  if (ledgers.emission.extractionInputsAttestation.seedClassesProvided) {
    out.push({
      clause: 'f',
      detail: 'a seed class was supplied to an extraction/classification stage',
    });
  }
}

// (h) — no content fetch against a held-out/control PR. The actual partition is
// DERIVED from the frozen split (heldOut membership), NOT trusted from the
// ledger's self-declared `slice` label — a buggy/adversarial producer could read
// held-out material and label it `slice: "train"`. The declared heldOutFetchCount
// is likewise recomputed from the entries, never trusted as an independent claim.
function checkApiUsage(ledgers: MinerLedgers, out: FmViolation[]): void {
  const heldOutSet = new Set(ledgers.split.split.heldOutPrs);
  const heldOutFetches = ledgers.apiUsage.entries.filter(
    (f) => heldOutSet.has(f.targetPr) || f.slice === 'heldOut',
  );
  if (heldOutFetches.length > 0 || ledgers.apiUsage.heldOutFetchCount !== heldOutFetches.length) {
    out.push({
      clause: 'h',
      detail: `held-out fetch(es) present or miscounted (derived=${heldOutFetches.length}, declared=${ledgers.apiUsage.heldOutFetchCount}, targets=[${heldOutFetches.map((f) => f.targetPr)}])`,
    });
  }
}

// (i) — every train PR must be processed by the emission OR the drop ledger.
// This is AT-LEAST-ONE (the ADR-111 FM(i) violation is "processed by NEITHER the
// emission ledger NOR the drop ledger"), NOT exactly-one: a single PR's review
// thread can yield multiple candidates, so the same train PR legitimately appears
// in BOTH ledgers (one candidate emitted, another dropped). `sourcePr` is
// required on every drop, so each drop is creditable here (no uncreditable gap).
function checkTrainCoverage(ledgers: MinerLedgers, out: FmViolation[]): void {
  const emitted = new Set(ledgers.emission.entries.map((e) => e.provenance.mergedPr));
  const dropped = new Set(ledgers.drop.entries.map((d) => d.sourcePr));
  for (const pr of ledgers.split.split.trainPrs) {
    if (!emitted.has(pr) && !dropped.has(pr)) {
      out.push({
        clause: 'i',
        detail: `train PR ${pr} processed by neither the emission nor the drop ledger`,
      });
    }
  }
}
