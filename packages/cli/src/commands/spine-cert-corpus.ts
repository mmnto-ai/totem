import type {
  DraftClassifier,
  DraftExtractor,
  GroundTruthLabel,
  MinerLedgers,
  ProvenanceRecord,
  ResolvedPrDiff,
  ReviewThreadSource,
  SplitArtifact,
  SplitLedger,
  Stage4VerifierDeps,
} from '@mmnto/totem';

import type { CertifyingCorpus } from './spine-windtunnel.js';

// ─── 5c-ii certifying-corpus orchestrator (extract → classify → compile) ───

export interface BuildCertifyingCorpusDeps {
  /** The frozen train/held-out/control split. */
  split: SplitArtifact;
  /** SplitLedger (split + corpusMergeCommits) for the classify integrity re-check. */
  splitLedger: SplitLedger;
  /**
   * Review-thread source. REPLAY (certifying run): a FROZEN source that reads
   * committed fixture content (zero network, fold-K). LIVE (record): the gh-CLI
   * adapter. The extract stage calls `source.fetch(pr)` to build the content the
   * replay extractor keys on, so the content must be reproducible either way.
   */
  source: ReviewThreadSource;
  /** Draft extractor. REPLAY: `ReplayDraftExtractor`; RECORD: `RecordingDraftExtractor`(Live). */
  extractor: DraftExtractor;
  /** Draft classifier. REPLAY: `ReplayDraftClassifier`; RECORD: `RecordingDraftClassifier`(Live). */
  classifier: DraftClassifier;
  /** Seed-blindness attestation (fold-I §7) — surfaced into the emission ledger. */
  seedClassesProvided: boolean;
  /** Stage-4 verifier deps (listFiles/readFile over the frozen post-image). */
  stage4: Stage4VerifierDeps;
  /** Injected timestamp (Tenet 15 determinism — no `new Date()` in the pipeline). */
  now: string;
  /** Resolved-PR diffs (corpus + positive/negative controls) for firing/scoring. */
  prDiffs: ResolvedPrDiff[];
  /** Frozen ground-truth labels keyed by firingLabelId (TP/FP). */
  groundTruth: Map<string, GroundTruthLabel>;
}

export interface CertifyingCorpusBuildResult {
  /** The corpus `runCertifyingEngine` scores (rules, prDiffs, groundTruth, provenanceByRule). */
  corpus: CertifyingCorpus;
  /** fold-I miner ledgers (emission/drop/classifier/split/apiUsage), emitted + CI-observable. */
  ledgers: MinerLedgers;
}

/**
 * Compose the shipped slice-2/3/4 stages into the certifying corpus (5c-ii).
 *
 * Runs Extract → Classify → Compile over the train slice via the injected ports
 * (REPLAY for the certifying run — zero LLM, zero network; RECORD wraps the live
 * adapters), then assembles the `CertifyingCorpus`:
 *  - **rules + provenanceByRule** from the compiled candidates;
 *  - **binding-2 (carried)**: archived (Stage-4 out-of-scope) rules are EXCLUDED
 *    from the scored set (archived ≠ wind-tunnel FP — `buildFirings`/fold-F would
 *    throw if one leaked); their provenance is dropped with them.
 *  - **fold-I (FM-h)**: the API-usage ledger's held-out-fetch-count MUST be 0 —
 *    a non-zero count means mining touched the held-out slice, which voids the
 *    run, so we fail loud here.
 *  - **prDiffs + groundTruth** are passed through from the (fixture or resolved)
 *    inputs; firing/scoring is the deterministic 5c-i engine's job downstream.
 *
 * Returns the corpus + the fold-I ledgers (emitted for §7 observability). Pure of
 * its own IO — all IO is behind the injected ports/deps, so it is fully testable
 * with fakes (no LLM, no network, no real git).
 */
export async function buildCertifyingCorpus(
  deps: BuildCertifyingCorpusDeps,
): Promise<CertifyingCorpusBuildResult> {
  const { runExtractStage, runClassifyStage, runCompileStage, assembleMinerLedgers, TotemError } =
    await import('@mmnto/totem');

  // Stage 1 — Extract (REPLAY or LIVE via the injected ports).
  const extract = await runExtractStage(deps.split, {
    source: deps.source,
    extractor: deps.extractor,
    seedClassesProvided: deps.seedClassesProvided,
  });

  // fold-I (FM-h): the held-out slice must NEVER be fetched during mining.
  if (extract.apiUsageLedger.heldOutFetchCount !== 0) {
    throw new TotemError(
      'CONFIG_INVALID',
      `Held-out fetch count is ${extract.apiUsageLedger.heldOutFetchCount}, must be 0 ` +
        `(fold-I / FM-h): mining touched the held-out slice, which voids the certifying run.`,
      'The extract stage fetched a held-out PR. Verify the split + fetch loop honor the train-only boundary.',
    );
  }

  // Stage 2 — Classify; Stage 3/4 — Compile + Stage-4 verify.
  const classify = await runClassifyStage(extract, deps.splitLedger, {
    classifier: deps.classifier,
  });
  const compileResult = await runCompileStage(classify, { stage4: deps.stage4, now: deps.now });

  // binding-2 (carried): exclude Stage-4 out-of-scope (archived) rules from the
  // scored set — archived ≠ wind-tunnel FP; fold-F throws if one reaches firing.
  const scored = compileResult.compiled.filter((c) => c.rule.status !== 'archived');
  const rules = scored.map((c) => c.rule);
  const provenanceByRule = new Map<string, ProvenanceRecord>(
    scored.map((c) => [c.rule.lessonHash, c.provenance]),
  );

  // fold-I ledgers — emitted + CI-observable (§7), never asserted-on beyond FM-h.
  const ledgers = assembleMinerLedgers(deps.splitLedger, extract, classify);

  return {
    corpus: { rules, prDiffs: deps.prDiffs, groundTruth: deps.groundTruth, provenanceByRule },
    ledgers,
  };
}
