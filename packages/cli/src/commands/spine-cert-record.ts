import type {
  DraftClassifier,
  DraftExtractor,
  ReviewThreadSource,
  SplitArtifact,
  SplitLedger,
} from '@mmnto/totem';

import {
  computeArtifactHash,
  RecordingDraftClassifier,
  RecordingDraftExtractor,
  type ReplayArtifact,
  ReplayDraftClassifier,
  ReplayDraftExtractor,
  type ReplayProvenance,
  ReplayRecordSink,
} from './spine-llm-replay.js';

/**
 * Minimal draft shape `certDraftRef` keys on — a structural subset of core's
 * (intentionally non-exported, transient) `DraftCandidate`. Assignable to the
 * `(draft: DraftCandidate) => string` resolver the Recording/Replay classifiers
 * expect, via parameter contravariance.
 */
type DraftRefInput = { provenance: { mergedPr: number }; dslSource: string };

/**
 * The shared per-draft ref resolver. MUST be byte-identical in RECORD and REPLAY
 * so `classifierInputKey(draft, draftRef(draft))` produces the same key in both —
 * a divergence here would make every replay a `ReplayMissError`. Keyed on the
 * provenance PR + the DSL body (a draft is uniquely identified by its source
 * within a PR); ordinal-free so it survives re-ordering.
 */
export function certDraftRef(d: DraftRefInput): string {
  return `cand-${d.provenance.mergedPr}-${d.dslSource}`;
}

export interface RecordReplayFixtureDeps {
  split: SplitArtifact;
  splitLedger: SplitLedger;
  /** Review-thread source (live gh adapter in the record command). */
  source: ReviewThreadSource;
  /** Live draft extractor to record (wrapped in RecordingDraftExtractor). */
  liveExtractor: DraftExtractor;
  /** Live draft classifier to record (wrapped in RecordingDraftClassifier). */
  liveClassifier: DraftClassifier;
  /** Seed-blindness attestation (passed through to extract). */
  seedClassesProvided: boolean;
  /** Prompt/provider provenance bound into the frozen artifact's whole-artifact hash. */
  provenance: ReplayProvenance;
}

/**
 * Drive the extract + classify stages through the RECORDING decorators to freeze
 * a `llm-replay.v1` fixture (A2 record path). Runs extract (records every
 * extractor output) then classify (records every classifier output) over the
 * train slice, then `sink.freeze(provenance)` → the artifact + its
 * `computeArtifactHash` (the EXTERNAL expected-hash the lock's L2 `llmReplaySha`
 * carries). Compile is NOT run here — recording captures only the non-deterministic
 * LLM edge (extract/classify); the deterministic compile/firing replays from it.
 */
export async function recordReplayFixture(
  deps: RecordReplayFixtureDeps,
): Promise<{ artifact: ReplayArtifact; hash: string }> {
  const { runExtractStage, runClassifyStage } = await import('@mmnto/totem');

  const sink = new ReplayRecordSink();
  const recExtractor = new RecordingDraftExtractor(deps.liveExtractor, sink);
  const recClassifier = new RecordingDraftClassifier(deps.liveClassifier, sink, certDraftRef);

  const extract = await runExtractStage(deps.split, {
    source: deps.source,
    extractor: recExtractor,
    seedClassesProvided: deps.seedClassesProvided,
  });
  await runClassifyStage(extract, deps.splitLedger, { classifier: recClassifier });

  const artifact = sink.freeze(deps.provenance);
  return { artifact, hash: computeArtifactHash(artifact) };
}

/**
 * Construct the REPLAY-mode extractor + classifier from a frozen artifact + its
 * external expected-hash (the lock's L2 `llmReplaySha`). Both constructors
 * re-validate the whole-artifact integrity (assertFixtureIntegrity) before any
 * lookup, so a tampered/stale fixture fails loud. Uses the shared `certDraftRef`
 * so keys match what `recordReplayFixture` froze. Pure: zero LLM, zero network.
 */
export function buildReplayAdapters(
  artifact: ReplayArtifact,
  expectedHash: string,
): { extractor: DraftExtractor; classifier: DraftClassifier } {
  return {
    extractor: new ReplayDraftExtractor(artifact, expectedHash),
    classifier: new ReplayDraftClassifier(artifact, expectedHash, certDraftRef),
  };
}
