import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  DraftClassifier,
  DraftExtractor,
  ReviewThreadContent,
  ReviewThreadSource,
  SplitArtifact,
  SplitLedger,
  WindtunnelLock,
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
  serializeReplayArtifact,
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

// ─── `spine windtunnel record` subcommand (A2) ───────

/** The injectable record deps — live in the CLI, fakes in tests. */
export interface RecordDeps {
  source: ReviewThreadSource;
  liveExtractor: DraftExtractor;
  liveClassifier: DraftClassifier;
  provenance: ReplayProvenance;
}

export interface RecordCommandOptions {
  /** Path to the wind-tunnel lock (default `.totem/spine/gate-1/windtunnel.lock.json`). */
  lockPath?: string;
  /** Gate-1 output dir (default: the lock's dir). */
  outputDir?: string;
  /**
   * Record deps. Injected in tests; in the live CLI path the caller builds them
   * from the orchestrator config (createOrchestrator + the Live adapters + the
   * gh ReviewThreadSource). REQUIRED — there is no safe default LLM/provider, so
   * the command fails loud rather than guess.
   */
  deps: RecordDeps;
}

/** Wrap a source so every fetched review-thread content is captured for freezing. */
function capturingSource(
  inner: ReviewThreadSource,
  captured: ReviewThreadContent[],
): ReviewThreadSource {
  return {
    async fetch(pr: number) {
      const result = await inner.fetch(pr);
      if (result.kind === 'ok') captured.push(result.content);
      return result;
    },
  };
}

/**
 * A2 record path — freeze the `llm-replay.v1` fixture + the review content the
 * certifying RUN replays. Loads the lock + split, drives extract→classify
 * through the RECORDING decorators over the train slice (capturing both the LLM
 * outputs AND the fetched review content), writes `llm-replay.v1.json` +
 * `review-content.json` to the gate-1 dir, and returns the artifact's
 * `computeArtifactHash` — the EXTERNAL hash the operator wires into the lock's L2
 * `controls.integrity.llmReplaySha`. Separate from `run` (fail-safe: `run` stays
 * replay-only and never triggers a live record in CI).
 */
export async function recordCommand(
  opts: RecordCommandOptions,
): Promise<{ artifactPath: string; contentPath: string; hash: string }> {
  const { WindtunnelLockSchema, SplitArtifactSchema } = await import('@mmnto/totem');

  const cwd = process.cwd();
  const lockPath = opts.lockPath
    ? path.resolve(cwd, opts.lockPath)
    : path.resolve(cwd, '.totem/spine/gate-1/windtunnel.lock.json');
  const gate1Dir = opts.outputDir ? path.resolve(cwd, opts.outputDir) : path.dirname(lockPath);

  const lock: WindtunnelLock = WindtunnelLockSchema.parse(
    JSON.parse(fs.readFileSync(lockPath, 'utf-8')),
  );
  const split: SplitArtifact = SplitArtifactSchema.parse(
    JSON.parse(fs.readFileSync(path.join(gate1Dir, 'split.json'), 'utf-8')),
  );

  const splitLedger: SplitLedger = {
    split,
    corpus: lock.corpus.resolvedPrs.map((p) => p.pr),
    corpusMergeCommits: lock.corpus.resolvedPrs.map((p) => ({
      pr: p.pr,
      mergeCommit: p.mergeCommit,
    })),
  };

  const capturedContent: ReviewThreadContent[] = [];
  const { artifact, hash } = await recordReplayFixture({
    split,
    splitLedger,
    source: capturingSource(opts.deps.source, capturedContent),
    liveExtractor: opts.deps.liveExtractor,
    liveClassifier: opts.deps.liveClassifier,
    seedClassesProvided: false,
    provenance: opts.deps.provenance,
  });

  fs.mkdirSync(gate1Dir, { recursive: true });
  const artifactPath = path.join(gate1Dir, 'llm-replay.v1.json');
  const contentPath = path.join(gate1Dir, 'review-content.json');
  fs.writeFileSync(artifactPath, serializeReplayArtifact(artifact), 'utf-8');
  fs.writeFileSync(contentPath, JSON.stringify(capturedContent, null, 2), 'utf-8');

  console.error(`[WindtunnelRecord] Froze ${artifactPath}`);
  console.error(`[WindtunnelRecord] Froze ${contentPath} (${capturedContent.length} PR(s))`);
  console.error(
    `[WindtunnelRecord] llm-replay hash (wire into lock controls.integrity.llmReplaySha):`,
  );
  console.log(hash);

  return { artifactPath, contentPath, hash };
}

/** Env var carrying each provider's credential (presence check, never read). */
const PROVIDER_CREDENTIAL_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
};

export interface LiveRecordConfig {
  provider: string;
  model: string;
  cwd: string;
  totemVersion: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Construct the LIVE record deps from the orchestrator config: the gh
 * ReviewThreadSource, an `InvokeOrchestrator` (createOrchestrator), the Live
 * extract/classify adapters (frozen prompts), and the run-level provenance.
 * Operational — exercised by hand when freezing a real corpus, never in CI
 * (the adapters' construction-time guards reject a CI env / missing credential).
 */
export async function buildLiveRecordDeps(
  lock: WindtunnelLock,
  config: LiveRecordConfig,
): Promise<RecordDeps> {
  const { createOrchestrator } = await import('../orchestrators/orchestrator.js');
  const {
    LiveDraftExtractor,
    LiveDraftClassifier,
    buildReplayProvenance,
    MINER_EXTRACT_SYSTEM_PROMPT,
    MINER_CLASSIFY_SYSTEM_PROMPT,
  } = await import('./spine-llm-adapters.js');
  const { ReviewThreadSourceAdapter } = await import('./spine-review-thread-source.js');

  const [owner, name] = lock.corpus.repo.split('/');
  if (!owner || !name) {
    throw new Error(`Record: lock.corpus.repo "${lock.corpus.repo}" is not "owner/name".`);
  }
  const env = config.env ?? process.env;
  const credentialPresent = Boolean(env[PROVIDER_CREDENTIAL_ENV[config.provider] ?? '']);

  const invoke = createOrchestrator({ provider: config.provider } as Parameters<
    typeof createOrchestrator
  >[0]);
  const totemDir = `${config.cwd}/.totem`;
  const adapterDeps = {
    invoke,
    model: config.model,
    cwd: config.cwd,
    totemDir,
    provider: config.provider,
    credentialPresent,
    temperature: 0,
    env,
  };

  return {
    source: new ReviewThreadSourceAdapter({ owner, name, cwd: config.cwd }),
    liveExtractor: new LiveDraftExtractor(adapterDeps),
    liveClassifier: new LiveDraftClassifier(adapterDeps),
    provenance: buildReplayProvenance({
      extractSystemPrompt: MINER_EXTRACT_SYSTEM_PROMPT,
      classifySystemPrompt: MINER_CLASSIFY_SYSTEM_PROMPT,
      provider: config.provider,
      model: config.model,
      temperature: 0,
      orchestratorVersion: config.totemVersion,
      totemVersion: config.totemVersion,
    }),
  };
}
