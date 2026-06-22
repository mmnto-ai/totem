import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import type {
  GroundTruthLabel,
  MinerLedgers,
  ResolvedPrDiff,
  ReviewThreadContent,
  ReviewThreadSource,
  SplitLedger,
  Stage4VerifierDeps,
  WindtunnelLock,
} from '@mmnto/totem';

/** Local alias for the core git exec port (mirrors spine-windtunnel.ts / spine-cert-materialize.ts). */
type SafeExecFn = typeof import('@mmnto/totem').safeExec;

import { buildCertifyingCorpus } from './spine-cert-corpus.js';
import { buildReplayAdapters } from './spine-cert-record.js';
import { type ReplayArtifact, ReplayArtifactSchema } from './spine-llm-replay.js';
import type { CertifyingCorpus, CertifyingCorpusProvider } from './spine-windtunnel.js';

// ─── Fixture file names under the gate-1 dir ─────────

const SPLIT_FILE = 'split.json';
const REPLAY_FILE = 'llm-replay.v1.json';
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
 * Load + validate the committed cert-run fixture inputs from the gate-1 dir.
 * Async so the `@mmnto/totem` runtime values (schema + error class) are
 * dynamically imported per the CLI lazy-import convention, not pulled in at
 * module load.
 */
export async function loadCertRunFixtures(
  gate1Dir: string,
  opts?: { expectedPrDiffsSha?: string; skipGroundTruth?: boolean },
): Promise<CertRunFixtureInputs> {
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
  const artifact = ReplayArtifactSchema.parse(loadJson(path.join(gate1Dir, REPLAY_FILE)));
  const content = z
    .array(ReviewThreadContentSchema)
    .parse(loadJson(path.join(gate1Dir, CONTENT_FILE)));

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

  // 5d-iii circularity guard: the label-deriver reuses this loader to enumerate
  // firings byte-identically to the run, but it PRODUCES ground-truth-labels.json
  // — so it must NOT read it (the file may not yet exist on a first derive, and
  // reading it would make the deriver depend on its own output). `skipGroundTruth`
  // returns an empty map; the run omits the flag and loads the frozen answer key.
  if (opts?.skipGroundTruth) {
    return { split, artifact, content, prDiffs, groundTruth: new Map<string, GroundTruthLabel>() };
  }

  const gtRecord = GroundTruthSchema.parse(loadJson(path.join(gate1Dir, GROUND_TRUTH_FILE)));
  const groundTruth = new Map<string, GroundTruthLabel>(Object.entries(gtRecord));
  return { split, artifact, content, prDiffs, groundTruth };
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
 * Build the REPLAY-mode `CertifyingCorpusProvider` the certifying run injects.
 *
 * Loads the committed cert-run fixtures (split, frozen `llm-replay.v1` artifact,
 * frozen review content, resolved-PR diffs, ground-truth labels) from the gate-1
 * dir, constructs the zero-network replay adapters (gated on the lock's L2
 * `llmReplaySha`) + a frozen review-thread source, then composes them through
 * `buildCertifyingCorpus`. fold-I ledgers are emitted (default: written to
 * `miner-ledgers.json`) for §7 observability. Throws loud if the lock lacks the
 * L2 replay hash (no safe default for an integrity gate).
 */
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

  const { split, artifact, content, prDiffs, groundTruth } = await loadCertRunFixtures(
    opts.gate1Dir,
    { expectedPrDiffsSha, skipGroundTruth: opts.skipGroundTruth },
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
