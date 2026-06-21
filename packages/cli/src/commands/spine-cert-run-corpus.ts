import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import {
  type GroundTruthLabel,
  type MinerLedgers,
  type ResolvedPrDiff,
  type ReviewThreadContent,
  type ReviewThreadSource,
  SplitArtifactSchema,
  type SplitLedger,
  type Stage4VerifierDeps,
  type WindtunnelLock,
} from '@mmnto/totem';

import { buildCertifyingCorpus } from './spine-cert-corpus.js';
import { buildReplayAdapters } from './spine-cert-record.js';
import { type ReplayArtifact, ReplayArtifactSchema } from './spine-llm-replay.js';
import type { CertifyingCorpus, CertifyingCorpusProvider } from './spine-windtunnel.js';

// ─── Fixture file names under the gate-1 dir ─────────

const SPLIT_FILE = 'split.json';
const REPLAY_FILE = 'llm-replay.v1.json';
const CONTENT_FILE = 'review-content.json';
const PR_DIFFS_FILE = 'pr-diffs.json';
const GROUND_TRUTH_FILE = 'ground-truth-labels.json';
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

function loadJson(file: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    throw new Error(`Cert-run fixture missing: ${file}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Cert-run fixture is not valid JSON (${file}): ${(err as Error).message}`);
  }
}

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

/** Load + validate the committed cert-run fixture inputs from the gate-1 dir. */
export function loadCertRunFixtures(gate1Dir: string): CertRunFixtureInputs {
  const split = SplitArtifactSchema.parse(loadJson(path.join(gate1Dir, SPLIT_FILE)));
  const artifact = ReplayArtifactSchema.parse(loadJson(path.join(gate1Dir, REPLAY_FILE)));
  const content = z
    .array(ReviewThreadContentSchema)
    .parse(loadJson(path.join(gate1Dir, CONTENT_FILE)));
  const prDiffs = z.array(ResolvedPrDiffSchema).parse(loadJson(path.join(gate1Dir, PR_DIFFS_FILE)));
  const gtRecord = GroundTruthSchema.parse(loadJson(path.join(gate1Dir, GROUND_TRUTH_FILE)));
  const groundTruth = new Map<string, GroundTruthLabel>(Object.entries(gtRecord));
  return { split, artifact, content, prDiffs, groundTruth };
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
export function buildReplayCorpusProvider(
  opts: ReplayCorpusProviderOptions,
): CertifyingCorpusProvider {
  return async (lock: WindtunnelLock): Promise<CertifyingCorpus> => {
    const expectedHash = lock.controls.integrity.llmReplaySha;
    if (!expectedHash) {
      throw new Error(
        'Certifying run: lock is missing controls.integrity.llmReplaySha (L2) — the frozen ' +
          'llm-replay fixture cannot be integrity-checked. Re-freeze the lock after a `record` run.',
      );
    }

    const { split, artifact, content, prDiffs, groundTruth } = loadCertRunFixtures(opts.gate1Dir);
    const { extractor, classifier } = buildReplayAdapters(artifact, expectedHash);

    const { corpus, ledgers } = await buildCertifyingCorpus({
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
