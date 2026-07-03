import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import type {
  AuthoredControlsDeps,
  GroundTruthLabel,
  MinerLedgers,
  ResolvedPrDiff,
  ReviewThreadContent,
  ReviewThreadSource,
  ScorerInput,
  SplitLedger,
  Stage4VerifierDeps,
  WindtunnelLock,
} from '@mmnto/totem';

/** Local alias for the core git exec port (mirrors spine-windtunnel.ts / spine-cert-materialize.ts). */
type SafeExecFn = typeof import('@mmnto/totem').safeExec;

import { buildAuthoredCertifyingCorpus } from './spine-authored-cert-corpus.js';
import { buildCertifyingCorpus } from './spine-cert-corpus.js';
import { buildReplayAdapters } from './spine-cert-record.js';
import { type ReplayArtifact, ReplayArtifactSchema } from './spine-llm-replay.js';
import type {
  CertifyingCorpus,
  CertifyingCorpusProvider,
  ResolvedCertifyingRun,
  ScoredRun,
} from './spine-windtunnel.js';

// ─── Fixture file names under the gate-1 dir ─────────

const SPLIT_FILE = 'split.json';
/** The frozen llm-replay fixture — produced by `record` (A2), sealed into the lock by `freeze`. */
export const REPLAY_FILE = 'llm-replay.v1.json';
const CONTENT_FILE = 'review-content.json';
export const PR_DIFFS_FILE = 'pr-diffs.json';
/** The cert-run answer key — produced by `derive-labels` (5d-iii), read by the run. */
export const GROUND_TRUTH_FILE = 'ground-truth-labels.json';
/** The frozen held-out disposition provenance — produced by `fetch-dispositions` (5d-ii). */
export const CORPUS_DISPOSITIONS_FILE = 'corpus-dispositions.json';
const LEDGERS_FILE = 'miner-ledgers.json';

// ─── Fixture schemas (the committed cert-run inputs) ──

const ReviewThreadContentSchema = z.object({
  pr: z.number().int().positive(),
  mergeCommitSha: z.string().regex(/^[0-9a-f]{40}$/),
  threads: z.array(
    z.object({
      path: z.string(),
      comments: z.array(z.object({ author: z.string(), body: z.string() })),
      isResolved: z.boolean(),
      isOutdated: z.boolean(),
    }),
  ),
});

const ResolvedPrDiffSchema = z.object({
  pr: z.number().int().positive(),
  diff: z.string(),
  controlKind: z.enum(['corpus', 'positive', 'negative']),
  targetRuleId: z.string().optional(),
});

// firingLabelId → TP|FP
const GroundTruthSchema = z.record(z.enum(['TP', 'FP']));

/** A zero-network ReviewThreadSource backed by committed, frozen review content. */
function frozenSourceFrom(contents: ReviewThreadContent[]): ReviewThreadSource {
  const byPr = new Map(contents.map((c) => [c.pr, c]));
  return {
    async fetch(pr: number) {
      const content = byPr.get(pr);
      return content
        ? { kind: 'ok' as const, content }
        : { kind: 'unreachable' as const, detail: `no frozen review content for pr ${pr}` };
    },
  };
}

export interface CertRunFixtureInputs {
  split: import('@mmnto/totem').SplitArtifact;
  artifact: ReplayArtifact;
  content: ReviewThreadContent[];
  prDiffs: ResolvedPrDiff[];
  groundTruth: Map<string, GroundTruthLabel>;
}

/**
 * The producer-independent **scoring substrate** read by BOTH the mined and authored
 * cert-run loaders: the frozen split + pr-diffs + ground-truth answer key, each carrying
 * the verify-then-parse-on-a-SINGLE-read integrity discipline (#2225/#709 fold-2). The
 * gate-critical SHA checks live here ONCE so the mined and authored paths cannot drift
 * (gemini Tenet-9 ruling 2026-06-30: this is a singular, cohesive job — shared, not a
 * forced merge of disjoint jobs; duplicating the SHA/CRLF integrity invites the drift
 * that is a worse failure mode than a shared helper). Mining-only fixtures (`llm-replay`,
 * `review-content`) are NOT read here — they belong to `loadCertRunFixtures` alone.
 */
export interface ScoringSubstrate {
  split: import('@mmnto/totem').SplitArtifact;
  prDiffs: ResolvedPrDiff[];
  groundTruth: Map<string, GroundTruthLabel>;
}

export async function readAndVerifyScoringSubstrate(
  gate1Dir: string,
  opts?: {
    expectedPrDiffsSha?: string;
    expectedGroundTruthSha?: string;
    skipGroundTruth?: boolean;
  },
): Promise<ScoringSubstrate> {
  const { SplitArtifactSchema, TotemError } = await import('@mmnto/totem');

  const readRaw = (file: string): string => {
    try {
      return fs.readFileSync(file, 'utf-8');
    } catch (err) {
      throw new TotemError(
        'CONFIG_INVALID',
        `Cert-run fixture missing: ${file}`,
        'Ensure the gate-1 fixture set exists and is readable.',
        err,
      );
    }
  };
  const parseJson = (raw: string, file: string): unknown => {
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new TotemError(
        'CONFIG_INVALID',
        `Cert-run fixture is not valid JSON (${file})`,
        'Re-freeze the gate-1 fixtures with `spine windtunnel record`.',
        err,
      );
    }
  };
  const loadJson = (file: string): unknown => parseJson(readRaw(file), file);

  const split = SplitArtifactSchema.parse(loadJson(path.join(gate1Dir, SPLIT_FILE)));

  // #2225 (#709 fold-2): verify-then-parse the SCORING source on a SINGLE read — the
  // digest must cover the exact bytes that get parsed + scored, not a separate read
  // (CR: no check/use split). CRLF→LF normalized to match the producer's LF-stamped
  // digest. The absent-from-lock case is the caller's precondition (it omits the sha).
  const prDiffsFile = path.join(gate1Dir, PR_DIFFS_FILE);
  const prDiffsRaw = readRaw(prDiffsFile);
  if (opts?.expectedPrDiffsSha !== undefined) {
    const actual = createHash('sha256')
      .update(prDiffsRaw.replace(/\r\n/g, '\n'), 'utf-8')
      .digest('hex');
    if (actual !== opts.expectedPrDiffsSha) {
      throw new TotemError(
        'CONFIG_INVALID',
        `Certifying run: pr-diffs.json integrity FAILED — expected ${opts.expectedPrDiffsSha}, got ` +
          `${actual} (the frozen scoring corpus was tampered or re-serialized).`,
        'Restore the frozen pr-diffs.json or re-materialize the cert corpus.',
      );
    }
  }
  const prDiffs = z.array(ResolvedPrDiffSchema).parse(parseJson(prDiffsRaw, prDiffsFile));

  // 5d-iii circularity guard: the label-deriver reuses this substrate to enumerate
  // firings byte-identically to the run, but it PRODUCES ground-truth-labels.json
  // — so it must NOT read it (the file may not yet exist on a first derive, and
  // reading it would make the deriver depend on its own output). `skipGroundTruth`
  // returns an empty map; the run omits the flag and loads the frozen answer key.
  if (opts?.skipGroundTruth) {
    return { split, prDiffs, groundTruth: new Map<string, GroundTruthLabel>() };
  }

  // #709 5d-iii-ii: verify-then-parse the ANSWER KEY on a SINGLE read — the run grades
  // firings against the frozen ground-truth-labels.json, so the digest must cover the
  // exact bytes parsed + scored, not a separate read (mirror prDiffsSha — no check/use
  // split). CRLF→LF normalized to match the deriver's LF-stamped digest. The absent-from-
  // lock case is the caller's precondition (it omits the sha). The deriver never reaches
  // here — `skipGroundTruth` returns above, because it PRODUCES this file (circularity).
  const groundTruthFile = path.join(gate1Dir, GROUND_TRUTH_FILE);
  const groundTruthRaw = readRaw(groundTruthFile);
  if (opts?.expectedGroundTruthSha !== undefined) {
    const actual = createHash('sha256')
      .update(groundTruthRaw.replace(/\r\n/g, '\n'), 'utf-8')
      .digest('hex');
    if (actual !== opts.expectedGroundTruthSha) {
      throw new TotemError(
        'CONFIG_INVALID',
        `Certifying run: ground-truth-labels.json integrity FAILED — expected ${opts.expectedGroundTruthSha}, got ` +
          `${actual} (the frozen answer key was tampered or re-serialized).`,
        'Re-derive the answer key with `spine windtunnel derive-labels` or re-materialize the cert corpus.',
      );
    }
  }
  const gtRecord = GroundTruthSchema.parse(parseJson(groundTruthRaw, groundTruthFile));
  const groundTruth = new Map<string, GroundTruthLabel>(Object.entries(gtRecord));
  return { split, prDiffs, groundTruth };
}

/**
 * Load + validate the committed MINED cert-run fixture inputs from the gate-1 dir: the
 * shared scoring substrate (`readAndVerifyScoringSubstrate`) PLUS the mining-only
 * `llm-replay` artifact + raw `review-content`. Async so the `@mmnto/totem` runtime
 * values (schema + error class) are dynamically imported per the CLI lazy-import
 * convention, not pulled in at module load.
 */
export async function loadCertRunFixtures(
  gate1Dir: string,
  opts?: {
    expectedPrDiffsSha?: string;
    expectedGroundTruthSha?: string;
    skipGroundTruth?: boolean;
  },
): Promise<CertRunFixtureInputs> {
  const { TotemError, classifyAuthorKind, normalizeReviewChrome } = await import('@mmnto/totem');
  const { enrichComment } = await import('./spine-review-thread-source.js');
  const enrich = { classifyAuthorKind, normalizeReviewChrome };

  const readRaw = (file: string): string => {
    try {
      return fs.readFileSync(file, 'utf-8');
    } catch (err) {
      throw new TotemError(
        'CONFIG_INVALID',
        `Cert-run fixture missing: ${file}`,
        'Ensure the gate-1 fixture set exists and is readable.',
        err,
      );
    }
  };
  const parseJson = (raw: string, file: string): unknown => {
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new TotemError(
        'CONFIG_INVALID',
        `Cert-run fixture is not valid JSON (${file})`,
        'Re-freeze the gate-1 fixtures with `spine windtunnel record`.',
        err,
      );
    }
  };
  const loadJson = (file: string): unknown => parseJson(readRaw(file), file);

  const artifact = ReplayArtifactSchema.parse(loadJson(path.join(gate1Dir, REPLAY_FILE)));
  // The committed content.json stores RAW comments (author + body + flags). ENRICH
  // each comment with `authorKind` + `normalizedBody` (slice β) via the SAME
  // `enrichComment` the live adapter uses, RE-DERIVED with the CURRENT normalizer —
  // so the replay-time `extractorInputKey` (keyed on `normalizedBody`) matches what
  // record stamped, and a normalizer change re-keys → a MISS forces a re-record
  // (Tenet-15). Any `authorKind`/`normalizedBody` already in the JSON is ignored
  // (the schema parses the raw shape), so a stale stored value can never be served.
  const rawContent = z
    .array(ReviewThreadContentSchema)
    .parse(loadJson(path.join(gate1Dir, CONTENT_FILE)));
  const content: ReviewThreadContent[] = rawContent.map((c) => ({
    ...c,
    threads: c.threads.map((t) => ({
      ...t,
      comments: t.comments.map((cm) => enrichComment(enrich, cm.author, cm.body)),
    })),
  }));

  // The shared scoring substrate carries the gate-critical integrity checks (single-homed).
  const { split, prDiffs, groundTruth } = await readAndVerifyScoringSubstrate(gate1Dir, opts);
  return { split, artifact, content, prDiffs, groundTruth };
}

/**
 * ADR-112 §5/§6 Slice D2 — load the AUTHORED cert-run scoring substrate from the gate-1
 * dir: the SIBLING of `loadCertRunFixtures` minus the mining-only `llm-replay` +
 * `review-content` legs (an authored run has neither). Delegates to the shared
 * `readAndVerifyScoringSubstrate` so the split/pr-diffs/ground-truth integrity discipline
 * is byte-identical to the mined path (gemini Tenet-9 ruling: shared helper, not a
 * duplicated SHA check). The authored producer supplies the rules; this supplies the
 * producer-independent scoring substrate (split for the §5 leakage gate, prDiffs as the
 * scoring corpus, groundTruth as the frozen answer key). The same hard preconditions as
 * mined apply at the caller (prDiffsSha/groundTruthSha MUST be present on a certifying
 * run). The DERIVER passes `skipGroundTruth` (D2.6) — see the opts note below.
 */
export async function loadAuthoredCertRunFixtures(
  gate1Dir: string,
  opts?: {
    expectedPrDiffsSha?: string;
    expectedGroundTruthSha?: string;
    // Slice D2.6: the window-wide DERIVER passes this — it PRODUCES ground-truth-labels.json
    // so it must not require/read it (circularity), exactly as the mined `loadCertRunFixtures`.
    skipGroundTruth?: boolean;
  },
): Promise<ScoringSubstrate> {
  return readAndVerifyScoringSubstrate(gate1Dir, opts);
}

/**
 * Build the Stage-4 verifier deps (listFiles/readFile over the frozen post-image
 * at `asOf`) — the SHARED constructor both the certifying run and the 5d-iii
 * deriver use, so the archived-rule exclusion (hence the scored rule set, hence
 * the firing labelIds) is identical. With an lc clone, files resolve via
 * `git ls-tree`/`git show` at `asOf` (a local clone — zero network); without one,
 * Stage-4 sees no files (rules read as untested, NOT archived). Tests inject a
 * fake `Stage4VerifierDeps` into `assembleCertifyingCorpus` directly instead.
 */
export function buildGate1Stage4Deps(
  lcDir: string | undefined,
  asOf: string,
  safeExec: SafeExecFn,
): Stage4VerifierDeps {
  if (lcDir) {
    return {
      // The `--` separator keeps the revision unambiguous from any path args and blocks
      // arg injection (CR coding guideline) — this shared path decides which files
      // Stage-4 sees for BOTH the run and the deriver, so rev/path ambiguity here would
      // shift archived-rule decisions and the derived labels.
      listFiles: async () =>
        safeExec('git', ['ls-tree', '-r', '--name-only', asOf, '--'], { cwd: lcDir })
          .split('\n')
          .filter(Boolean),
      readFile: async (f: string) =>
        safeExec('git', ['show', `${asOf}:${f.replace(/\\/g, '/')}`, '--'], { cwd: lcDir }),
      workingDirectory: lcDir,
    };
  }
  return {
    // No lc clone → Stage-4 sees no files (rules read as 'no-matches' / untested,
    // NOT archived) — the wind-tunnel firing/scoring still runs.
    listFiles: async () => [],
    readFile: async (f: string) => {
      const { TotemError } = await import('@mmnto/totem');
      throw new TotemError(
        'CONFIG_INVALID',
        `Cert run: no lc clone (--lc-dir) — cannot read ${f} for Stage-4.`,
        'Provide the lc clone via --lc-dir or the TOTEM_LC_DIR environment variable.',
      );
    },
  };
}

/** Derive the SplitLedger from the loaded split + the lock's resolved corpus. */
function splitLedgerFrom(
  split: import('@mmnto/totem').SplitArtifact,
  lock: WindtunnelLock,
): SplitLedger {
  return {
    split,
    corpus: lock.corpus.resolvedPrs.map((p) => p.pr),
    corpusMergeCommits: lock.corpus.resolvedPrs.map((p) => ({
      pr: p.pr,
      mergeCommit: p.mergeCommit,
    })),
  };
}

export interface ReplayCorpusProviderOptions {
  /** The `.totem/spine/gate-1` dir holding the committed cert-run fixtures. */
  gate1Dir: string;
  /** Stage-4 verifier deps (listFiles/readFile) — injected so the run is testable. */
  stage4: Stage4VerifierDeps;
  /** Injected timestamp (Tenet 15 determinism). */
  now: string;
  /** Seed-blindness attestation (fold-I §7). */
  seedClassesProvided?: boolean;
  /** Optional sink for the fold-I miner ledgers (defaults to gate1Dir/miner-ledgers.json). */
  onLedgers?: (ledgers: MinerLedgers) => void;
}

/**
 * Assemble the REPLAY-mode `CertifyingCorpus` (rules + prDiffs + provenance) from
 * the committed gate-1 fixtures — the SHARED path both the certifying run (via
 * `buildReplayCorpusProvider`) and the 5d-iii label-deriver call, so the corpus
 * they enumerate firings over is byte-identical (the answer-key labelIds the
 * deriver mints are the ones the run looks up). The deriver passes
 * `skipGroundTruth: true` — it PRODUCES `ground-truth-labels.json`, so it must
 * not read it (circularity guard); the run omits the flag and loads the frozen
 * answer key. Returns the fold-I ledgers too; the caller decides whether to emit
 * them (the run does; the deriver discards — they belong to the run artifact).
 */
export async function assembleCertifyingCorpus(
  opts: ReplayCorpusProviderOptions & { skipGroundTruth?: boolean },
  lock: WindtunnelLock,
): Promise<{ corpus: CertifyingCorpus; ledgers: MinerLedgers }> {
  const { TotemError } = await import('@mmnto/totem');
  const expectedHash = lock.controls.integrity.llmReplaySha;
  if (!expectedHash) {
    throw new TotemError(
      'CONFIG_INVALID',
      'Certifying run: lock is missing controls.integrity.llmReplaySha (L2) — the frozen ' +
        'llm-replay fixture cannot be integrity-checked.',
      'Re-freeze the lock after a `record` run.',
    );
  }

  // #2225 (#709 fold-2): hash-bind the SCORING source. `pr-diffs.json` is otherwise
  // unprotected — `fixtureSha` covers only the control dirs — so a silent mutation of
  // any row (advisory-window OR control) would corrupt the answer key while the
  // control-dir gate stays green. The absent-from-lock case is a lock precondition
  // (checked here); `loadCertRunFixtures` verifies the digest on the SAME read it
  // parses — no check/use split (CR). Fail loud (strategy ruled: verify at freeze AND run).
  const expectedPrDiffsSha = lock.controls.integrity.prDiffsSha;
  if (!expectedPrDiffsSha) {
    throw new TotemError(
      'CONFIG_INVALID',
      'Certifying run: lock is missing controls.integrity.prDiffsSha (#709 fold-2) — the ' +
        'pr-diffs.json scoring source cannot be integrity-checked.',
      'Re-materialize the cert corpus with `spine windtunnel materialize`.',
    );
  }

  // #709 5d-iii-ii: the ANSWER KEY digest is run-critical like prDiffsSha — the run reads
  // the MATERIALIZED frozen labels (never re-derives), so without this the cert could grade
  // against a tampered/stale answer key while every other gate stays green. Gated on the RUN
  // path: the deriver (skipGroundTruth) PRODUCES ground-truth-labels.json + stamps
  // groundTruthSha, so on a first derive the lock legitimately has none yet.
  const expectedGroundTruthSha = lock.controls.integrity.groundTruthSha;
  if (!opts.skipGroundTruth && !expectedGroundTruthSha) {
    throw new TotemError(
      'CONFIG_INVALID',
      'Certifying run: lock is missing controls.integrity.groundTruthSha (#709 5d-iii) — the ' +
        'ground-truth-labels.json answer key cannot be integrity-checked.',
      'Re-derive the answer key with `spine windtunnel derive-labels` (it stamps groundTruthSha) and re-freeze.',
    );
  }

  const { split, artifact, content, prDiffs, groundTruth } = await loadCertRunFixtures(
    opts.gate1Dir,
    {
      expectedPrDiffsSha,
      expectedGroundTruthSha: opts.skipGroundTruth ? undefined : expectedGroundTruthSha,
      skipGroundTruth: opts.skipGroundTruth,
    },
  );
  const { extractor, classifier } = buildReplayAdapters(artifact, expectedHash);

  return buildCertifyingCorpus({
    split,
    splitLedger: splitLedgerFrom(split, lock),
    source: frozenSourceFrom(content),
    extractor,
    classifier,
    seedClassesProvided: opts.seedClassesProvided ?? false,
    stage4: opts.stage4,
    now: opts.now,
    prDiffs,
    groundTruth,
  });
}

/**
 * Build the REPLAY-mode `CertifyingCorpusProvider` the certifying run injects: a thin
 * wrapper over `assembleCertifyingCorpus` (fixture-load + replay adapters + the
 * `buildCertifyingCorpus` composition) that also emits the fold-I miner ledgers
 * (default: `miner-ledgers.json`) for §7 observability. The deriver calls
 * `assembleCertifyingCorpus` directly instead (it skips ground-truth + discards the
 * ledgers, which belong to the run artifact).
 */
export function buildReplayCorpusProvider(
  opts: ReplayCorpusProviderOptions,
): CertifyingCorpusProvider {
  return async (lock: WindtunnelLock): Promise<CertifyingCorpus> => {
    const { corpus, ledgers } = await assembleCertifyingCorpus(opts, lock);

    // fold-I (§7): emit the miner ledgers, observable beside the cert-run report.
    if (opts.onLedgers) {
      opts.onLedgers(ledgers);
    } else {
      fs.mkdirSync(opts.gate1Dir, { recursive: true });
      fs.writeFileSync(
        path.join(opts.gate1Dir, LEDGERS_FILE),
        JSON.stringify(ledgers, null, 2),
        'utf-8',
      );
    }

    return corpus;
  };
}

/** Injected inputs for the AUTHORED window-wide answer-key deriver's assembly (D2.6). */
export interface AuthoredCorpusAssemblyOptions {
  /** The `.totem/spine/gate-1` dir holding the committed authored scoring substrate. */
  gate1Dir: string;
  /** The `.totem` dir holding the authored producer's `spine/authored-rules.yaml` + ledger. */
  totemDir: string;
  /** Stage-4 verifier deps (listFiles/readFile) for the compile stage. */
  stage4: Stage4VerifierDeps;
  /** Injected timestamp (Tenet 15 determinism). */
  now: string;
  /** Optional §4 differential-evaluator injection (defaults to the real one). */
  authoredControlsDeps?: AuthoredControlsDeps;
  /** Repo root + exec for the R1 freeze-binding resolve+prove (REQUIRED when the lock's
   *  expectedSplitRef is content-addressed; a content-addressed run without them fails loud —
   *  the proof is never skipped). */
  repoRoot?: string;
  safeExec?: SafeExecFn;
}

/**
 * ADR-112 §6/§5.3 Slice D2.6 — assemble the AUTHORED `CertifyingCorpus` for the
 * window-wide answer-key DERIVER: the authored sibling of `assembleCertifyingCorpus`'s
 * skip-ground-truth path. `derive-labels` calls this directly — NOT
 * `resolveCertifyingCorpusProvider` (the RUN-path §8 single home; gemini's single-home
 * ruling is untouched). The deriver is a by-hand producer step that enumerates firings
 * over the authored substrate, not a run resolving a provider, so it mirrors the mined
 * deriver's direct `assembleCertifyingCorpus` call rather than re-homing onto the resolver.
 *
 * Ground-truth is ALWAYS skipped: the deriver PRODUCES `ground-truth-labels.json`, so it
 * must not require/read it (circularity). The SCORING source is still hash-bound
 * (`prDiffsSha`) — a tampered pr-diffs.json would corrupt every derived label. The §8
 * ledger-sourced `judgedBy` stays owned by `buildAuthoredCertifyingCorpus` (strategy (iii)).
 * Returns only `{ corpus }` — an authored run mints no miner ledgers.
 */
/**
 * R1: resolve + PROVE the freeze binding at a cert-run boundary. Free-text refs
 * return `undefined` (legacy adherence shape). A content-addressed ref REQUIRES
 * the proof deps — refusing beats silently skipping the shared-history proof
 * (the never-unverified-binding invariant; strategy #2293 round-1 couple read).
 */
async function resolveRunFreezeBinding(args: {
  expectedSplitRef: string;
  totemDir: string;
  repoRoot?: string;
  safeExec?: SafeExecFn;
  boundary: string;
}): Promise<import('../spine-freeze-proof.js').FreezeBinding | undefined> {
  const { SPLIT_REF_RE, TotemError } = await import('@mmnto/totem');
  if (!SPLIT_REF_RE.test(args.expectedSplitRef)) return undefined;
  if (args.repoRoot === undefined || args.safeExec === undefined) {
    throw new TotemError(
      'GATE_INVALID',
      `${args.boundary}: the lock's expectedSplitRef is content-addressed (${args.expectedSplitRef.slice(0, 20)}…) but no repoRoot/safeExec were provided for the freeze proof — a frozen-artifact run never skips resolve+prove (ADR-112 §5.1 R1).`,
      'Thread repoRoot + safeExec into the run inputs so the freeze binding can be proven.',
    );
  }
  const { resolveProvenFreezeBinding } = await import('../spine-freeze-proof.js');
  return resolveProvenFreezeBinding({
    totemDir: args.totemDir,
    repoRoot: args.repoRoot,
    splitRef: args.expectedSplitRef,
    safeExec: args.safeExec,
  });
}

export async function assembleAuthoredCertifyingCorpus(
  opts: AuthoredCorpusAssemblyOptions,
  lock: WindtunnelLock,
): Promise<{ corpus: CertifyingCorpus }> {
  const { TotemError } = await import('@mmnto/totem');

  // require-when-authored (mirrors resolveCertifyingCorpusProvider): the lock's `authored`
  // block (expectedSplitRef) is the split-binding every derived label is bound to.
  if (!lock.authored) {
    throw new TotemError(
      'CONFIG_INVALID',
      "derive-labels (authored): lock declares producerKind 'authored' but has no `authored` " +
        'run-input block (expectedSplitRef) — the authored split binding is unbound (ADR-112 §8/D2).',
      'Add the `authored: { expectedSplitRef }` block to the lock, or derive against a mined lock.',
    );
  }

  const { prDiffsSha } = lock.controls.integrity;
  if (!prDiffsSha) {
    throw new TotemError(
      'CONFIG_INVALID',
      'derive-labels (authored): lock is missing controls.integrity.prDiffsSha — the pr-diffs.json ' +
        'scoring source cannot be integrity-checked.',
      'Re-materialize the cert corpus with `spine windtunnel materialize`.',
    );
  }

  const { split, prDiffs, groundTruth } = await loadAuthoredCertRunFixtures(opts.gate1Dir, {
    expectedPrDiffsSha: prDiffsSha,
    skipGroundTruth: true,
  });

  const freezeBinding = await resolveRunFreezeBinding({
    expectedSplitRef: lock.authored.expectedSplitRef,
    totemDir: opts.totemDir,
    repoRoot: opts.repoRoot,
    safeExec: opts.safeExec,
    boundary: 'derive-labels (authored)',
  });

  const corpus = await buildAuthoredCertifyingCorpus({
    totemDir: opts.totemDir,
    // NO judgedBy — the §8 single source is derived from the authoring-ledger INSIDE
    // buildAuthoredCertifyingCorpus (strategy (iii)); the lock must not be a second source.
    expectedSplitRef: lock.authored.expectedSplitRef,
    split,
    prDiffs,
    groundTruth,
    stage4: opts.stage4,
    now: opts.now,
    ...(opts.authoredControlsDeps ? { authoredControlsDeps: opts.authoredControlsDeps } : {}),
    ...(freezeBinding !== undefined ? { freezeBinding } : {}),
  });

  return { corpus };
}

/** The raw run-context the SINGLE dispatch home consumes to assemble EITHER provider —
 *  kind-agnostic, so the caller never branches on `producerKind` (gemini §8 single-home
 *  ruling 2026-06-30: a caller `if (producerKind)` would leak the dispatch out of the
 *  resolver). The resolver alone reads `lock.producerKind` and uses the inputs each
 *  branch needs (mined: gate1Dir/stage4/now/ledger sink; authored: + totemDir + the
 *  lock's `authored` block + the authored substrate it loads). */
export interface ResolveCorpusProviderInputs {
  /** The `.totem/spine/gate-1` dir holding the committed cert-run fixtures (mined replay OR authored substrate). */
  gate1Dir: string;
  /** Stage-4 verifier deps (listFiles/readFile) — shared by both producers. */
  stage4: Stage4VerifierDeps;
  /** Injected run timestamp (Tenet 15 determinism). */
  now: string;
  /** The `.totem` dir holding the authored producer's `spine/authored-rules.yaml` + ledger (authored path only). */
  totemDir: string;
  /** fold-I seed-blindness attestation (mined replay path; §7). */
  seedClassesProvided?: boolean;
  /** Optional sink for the fold-I miner ledgers (mined replay path; defaults to gate1Dir/miner-ledgers.json). */
  onLedgers?: (ledgers: MinerLedgers) => void;
  /** Optional §4 differential-evaluator injection for the authored controls (authored path; defaults to the real one). */
  authoredControlsDeps?: AuthoredControlsDeps;
  /** Repo root + exec for the R1 freeze-binding resolve+prove (REQUIRED when the lock's
   *  expectedSplitRef is content-addressed; a content-addressed run without them fails loud —
   *  the proof is never skipped). */
  repoRoot?: string;
  safeExec?: SafeExecFn;
}

/**
 * ADR-112 §8 Slice D1/D2 — the SINGLE dispatch home: resolve the right
 * `CertifyingCorpusProvider` from the lock's `producerKind` (absent ⇒ 'mined', the
 * canonical default mirroring `provenanceKind`). The generic provider is passed
 * downstream; NO `if (kind==='authored')` is scattered into the caller, engine, or
 * persist path — the caller passes raw `inputs` unconditionally and this is the ONE
 * place that reads the kind (gemini §8 single-home ruling).
 *
 * - **Mined** (absent ⇒ mined): byte-unchanged behavior — returns `buildReplayCorpusProvider`.
 * - **Authored** (D2): require the lock's `authored` run-input block (codex require-when-
 *   authored ruling — the schema only enforces the *reject-unless* direction), apply the
 *   SAME hard integrity preconditions as mined (`prDiffsSha` + `groundTruthSha` MUST be
 *   present on a certifying run — a tampered/stale scoring source or answer key must fail
 *   loud), load the authored scoring substrate via `loadAuthoredCertRunFixtures`, and
 *   assemble `BuildAuthoredCertifyingCorpusDeps` (lock-sourced `expectedSplitRef`; `judgedBy`
 *   is the §8 single source derived from the ledger INSIDE the assembler, never the lock —
 *   strategy (iii)) + the loaded split/prDiffs/groundTruth + totemDir/stage4/now). Async because the
 *   authored substrate load is IO — the dispatch stays single-homed by owning that load
 *   here rather than pushing a kind-branch up to the caller.
 *
 * NOTE (D2.5, ADR-112 §6): under `producerKind:'authored'` the answer key
 * (`ground-truth-labels.json`) MUST be derived WINDOW-WIDE (train + held-out), not
 * held-out-only. Authored positive controls are train-side, so a held-out-only answer
 * key leaves their firings unlabeled → `needsAdjudication` → a run that can never PASS
 * (permanent HONEST-NEGATIVE; totem-agy's D2 mechanical proof). D2 wires the input path
 * (test-lock-only — no production authored lock exists yet) and tracks the window-wide
 * deriver as a follow-on; a production authored run is NOT ready until D2.5 lands.
 */
export async function resolveCertifyingCorpusProvider(
  lock: WindtunnelLock,
  inputs: ResolveCorpusProviderInputs,
): Promise<ResolvedCertifyingRun> {
  // Dynamic import (CLI lazy-load convention — CR #2285): @mmnto/totem is heavy; the scorers
  // are captured here (the resolver is async) and closed over by the sync `score` bundle below.
  const { TotemError, scoreWindtunnel, scoreAuthoredWindtunnel, deriveGate2Eligibility } =
    await import('@mmnto/totem');
  const producerKind = lock.producerKind ?? 'mined';
  if (producerKind === 'authored') {
    // require-when-authored (codex): the lock's `authored` run-input block is mandatory at
    // cert resolve. The schema enforces only the reject-unless direction (a stray block on a
    // mined lock) — a producerKind:'authored' lock can predate its inputs, so the *require*
    // is phase-aware and lives here, with a caller-specific message (the resolver has the lock).
    if (!lock.authored) {
      throw new TotemError(
        'CONFIG_INVALID',
        "Certifying run: lock declares producerKind 'authored' but has no `authored` run-input block " +
          '(expectedSplitRef) — the authored cert-run split binding is unbound (ADR-112 §8/D2).',
        'Add the `authored: { expectedSplitRef }` block to the lock, or run a mined lock.',
      );
    }

    // Same hard integrity preconditions as the mined path (assembleCertifyingCorpus): the
    // scoring source + answer key MUST be hash-bound on a certifying run, else a tampered/
    // stale fixture would grade silently. The authored path has NO `llmReplaySha` (no mining
    // replay artifact) — only prDiffsSha + groundTruthSha apply.
    const { prDiffsSha, groundTruthSha } = lock.controls.integrity;
    if (!prDiffsSha) {
      throw new TotemError(
        'CONFIG_INVALID',
        'Certifying run (authored): lock is missing controls.integrity.prDiffsSha — the pr-diffs.json ' +
          'scoring source cannot be integrity-checked.',
        'Re-materialize the cert corpus with `spine windtunnel materialize`.',
      );
    }
    if (!groundTruthSha) {
      throw new TotemError(
        'CONFIG_INVALID',
        'Certifying run (authored): lock is missing controls.integrity.groundTruthSha — the ' +
          'ground-truth-labels.json answer key cannot be integrity-checked.',
        'Re-derive the answer key with `spine windtunnel derive-labels` (it stamps groundTruthSha) and re-freeze.',
      );
    }

    const { split, prDiffs, groundTruth } = await loadAuthoredCertRunFixtures(inputs.gate1Dir, {
      expectedPrDiffsSha: prDiffsSha,
      expectedGroundTruthSha: groundTruthSha,
    });

    // §8 single home (D4 reachable flip): EAGER-build the authored corpus HERE so the scorer
    // binds to THIS run's authored substrate (authoredControls + heldOutPrs) at resolution
    // time. This also runs the D2.5 no-mint `verifyOnly` gate at the EARLIEST point — before
    // the engine, before any scorer call or ledger write (codex Q2). Built once; the provider
    // hands the SAME corpus to the engine, so the firings score the corpus that was built.
    const freezeBinding = await resolveRunFreezeBinding({
      expectedSplitRef: lock.authored.expectedSplitRef,
      totemDir: inputs.totemDir,
      repoRoot: inputs.repoRoot,
      safeExec: inputs.safeExec,
      boundary: 'Certifying run (authored)',
    });

    const authoredCorpus = await buildAuthoredCertifyingCorpus({
      totemDir: inputs.totemDir,
      // NO judgedBy — it is the §8 single source in the authoring-ledger, derived inside
      // buildAuthoredCertifyingCorpus (strategy (iii)); the lock must not be a second source.
      expectedSplitRef: lock.authored.expectedSplitRef,
      split,
      prDiffs,
      groundTruth,
      stage4: inputs.stage4,
      now: inputs.now,
      ...(inputs.authoredControlsDeps ? { authoredControlsDeps: inputs.authoredControlsDeps } : {}),
      ...(freezeBinding !== undefined ? { freezeBinding } : {}),
    });

    // Fail-loud, NEVER fall back to the mined scorer (codex Q1): an authored corpus MUST carry
    // its §6 controls (defined-with-empty-arrays for a no-fixture author, never undefined). A
    // missing substrate scored by the mined scorer would silently PASS a culled differential.
    if (!authoredCorpus.authoredControls) {
      throw new TotemError(
        'GATE_INVALID',
        'Certifying run (authored): the authored corpus produced no `authoredControls` — the §6 ' +
          'emission substrate is unbound. Refusing to score an authored corpus with the mined scorer ' +
          '(ADR-112 §5.3 D4 — that would silently PASS a culled differential).',
        'Re-derive the authored controls (`spine windtunnel derive-labels`) and re-freeze the cert corpus.',
      );
    }
    const authoredControls = authoredCorpus.authoredControls;
    const heldOutPrs: ReadonlySet<number> = new Set(split.heldOutPrs);

    return {
      // The lock is accepted (CertifyingCorpusProvider contract) but intentionally ignored:
      // the corpus is eager-built + captured at resolve, so provider-call time needs nothing
      // from it (greptile #2285 P2 — signature parity + self-documented intentional ignore).
      provider: async (_lock: WindtunnelLock): Promise<CertifyingCorpus> => authoredCorpus,
      score: (base: ScorerInput): ScoredRun => {
        // Q1 threading guard: positives are derived INSIDE scoreAuthoredWindtunnel from
        // `authoredControls.positive` — never double-source `engineResult.positiveControlTargets`
        // (that reopens the postimage re-proof the D3 reduction discharged).
        const { positiveControlTargets: _minedPositives, ...rest } = base;
        const verdict = scoreAuthoredWindtunnel({ ...rest, authoredControls, heldOutPrs });
        // Gate-2 eligibility is DOWNSTREAM of the scorer (Q2): the scorer emits raw
        // heldOutActivationsByRule; the intersection (+ §1(k) + the Q4 illegitimate-window
        // disqualifier) is derived here, verdict-inert.
        const gate2 = deriveGate2Eligibility({ mintedRuleIds: base.mintedRuleIds, verdict });
        return { kind: 'authored', verdict, gate2 };
      },
    };
  }

  return {
    provider: buildReplayCorpusProvider({
      gate1Dir: inputs.gate1Dir,
      stage4: inputs.stage4,
      now: inputs.now,
      ...(inputs.seedClassesProvided !== undefined
        ? { seedClassesProvided: inputs.seedClassesProvided }
        : {}),
      ...(inputs.onLedgers ? { onLedgers: inputs.onLedgers } : {}),
    }),
    // Mined path byte-unchanged: the mined scorer, no authored overhead (gemini Q3 non-interference).
    score: (base: ScorerInput): ScoredRun => ({ kind: 'mined', verdict: scoreWindtunnel(base) }),
  };
}
