import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  ClassifierResult,
  DraftClassifier,
  DraftExtractor,
  FetchResult,
  MinerLedgers,
  ReviewThreadContent,
  ReviewThreadSource,
  SplitArtifact,
  SplitLedger,
  Stage4VerifierDeps,
  WindtunnelLock,
} from '@mmnto/totem';

import { recordReplayFixture } from './spine-cert-record.js';
import { buildReplayCorpusProvider } from './spine-cert-run-corpus.js';
import { type ReplayProvenance, serializeReplayArtifact } from './spine-llm-replay.js';

// ─── Fixtures ────────────────────────────────────────

const sha = (n: number): string => String(n).padStart(40, '0');
const NOW = '2026-06-19T12:00:00.000Z';

const REGEX_DSL = [
  '**Pattern:** `forbiddenCall\\(`',
  '**Engine:** regex',
  '**Severity:** warning',
  '',
  '### Bad Example',
  '```ts',
  'forbiddenCall()',
  '```',
].join('\n');

const PROVENANCE: ReplayProvenance = {
  promptTemplateHash: sha(11),
  systemPromptHash: sha(12),
  provider: 'anthropic',
  model: 'claude-test',
  temperature: 0,
  orchestratorVersion: '0.0.0-test',
  adapterKind: 'extractor+classifier',
  keyVersion: 'v1',
  totemVersion: '0.0.0-test',
};

const SPLIT: SplitArtifact = {
  asOfCommit: sha(100),
  trainPrs: [1],
  heldOutPrs: [],
  excludedPrs: [],
  positiveControlPrs: [],
  negativeControlPrs: [],
  splitRule: { predicate: 'code-touching non-bot', cutIndex: 1 },
};

const SPLIT_LEDGER: SplitLedger = {
  split: SPLIT,
  corpus: [1],
  corpusMergeCommits: [{ pr: 1, mergeCommit: sha(1) }],
};

function content(pr: number): ReviewThreadContent {
  return {
    pr,
    mergeCommitSha: sha(pr),
    threads: [
      {
        path: 'src/a.ts',
        comments: [{ author: 'Jane', body: 'note' }],
        isResolved: false,
        isOutdated: false,
      },
    ],
  };
}

function fakeSource(): ReviewThreadSource {
  return {
    async fetch(pr: number): Promise<FetchResult> {
      return { kind: 'ok', content: content(pr) };
    },
  };
}
function fakeExtractor(): DraftExtractor {
  return {
    async draft(): Promise<string[]> {
      return [REGEX_DSL];
    },
  };
}
function fakeClassifier(): DraftClassifier {
  return {
    async classify(): Promise<ClassifierResult> {
      return { disposition: 'structural', dispositionSource: 'classified' };
    },
  };
}
function stage4(files: Record<string, string>): Stage4VerifierDeps {
  return {
    listFiles: () => Promise.resolve(Object.keys(files)),
    readFile: (f: string) =>
      f in files ? Promise.resolve(files[f] as string) : Promise.reject(new Error(`absent ${f}`)),
  };
}

/** A minimal lock partial — the provider reads the L2 hash, the pr-diffs + ground-truth digests, + resolved corpus. */
function lockWith(
  llmReplaySha?: string,
  prDiffsSha?: string,
  groundTruthSha?: string,
): WindtunnelLock {
  return {
    controls: { integrity: { llmReplaySha, prDiffsSha, groundTruthSha } },
    corpus: { resolvedPrs: [{ pr: 1, mergeCommit: sha(1) }] },
  } as unknown as WindtunnelLock;
}

let tmpDir: string;
let gate1Dir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-cert-run-'));
  gate1Dir = path.join(tmpDir, 'gate-1');
  fs.mkdirSync(gate1Dir, { recursive: true });

  // Freeze a replay fixture from the live fakes, then lay down the committed
  // cert-run inputs the run path loads.
  const { artifact } = await recordReplayFixture({
    split: SPLIT,
    splitLedger: SPLIT_LEDGER,
    source: fakeSource(),
    liveExtractor: fakeExtractor(),
    liveClassifier: fakeClassifier(),
    seedClassesProvided: false,
    provenance: PROVENANCE,
  });

  fs.writeFileSync(path.join(gate1Dir, 'split.json'), JSON.stringify(SPLIT), 'utf-8');
  fs.writeFileSync(
    path.join(gate1Dir, 'llm-replay.v1.json'),
    serializeReplayArtifact(artifact),
    'utf-8',
  );
  fs.writeFileSync(
    path.join(gate1Dir, 'review-content.json'),
    JSON.stringify([content(1)]),
    'utf-8',
  );
  fs.writeFileSync(path.join(gate1Dir, 'pr-diffs.json'), JSON.stringify([]), 'utf-8');
  fs.writeFileSync(path.join(gate1Dir, 'ground-truth-labels.json'), JSON.stringify({}), 'utf-8');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Recompute the artifact hash the lock must carry (L2), from the written fixture. */
async function fixtureHash(): Promise<string> {
  const { hash } = await recordReplayFixture({
    split: SPLIT,
    splitLedger: SPLIT_LEDGER,
    source: fakeSource(),
    liveExtractor: fakeExtractor(),
    liveClassifier: fakeClassifier(),
    seedClassesProvided: false,
    provenance: PROVENANCE,
  });
  return hash;
}

/** sha256 of the CRLF→LF-normalized on-disk pr-diffs.json — the digest the run gate (#2225) asserts. */
function prDiffsHash(): string {
  return createHash('sha256')
    .update(
      fs.readFileSync(path.join(gate1Dir, 'pr-diffs.json'), 'utf-8').replace(/\r\n/g, '\n'),
      'utf-8',
    )
    .digest('hex');
}

/** sha256 of the CRLF→LF-normalized on-disk ground-truth-labels.json — the digest the run gate (#709 5d-iii-ii) asserts. */
function groundTruthHash(): string {
  return createHash('sha256')
    .update(
      fs
        .readFileSync(path.join(gate1Dir, 'ground-truth-labels.json'), 'utf-8')
        .replace(/\r\n/g, '\n'),
      'utf-8',
    )
    .digest('hex');
}

// ─── Tests ───────────────────────────────────────────

describe('buildReplayCorpusProvider (run-path)', () => {
  it('loads the committed fixtures + replays them into a corpus (zero LLM/network)', async () => {
    const hash = await fixtureHash();
    let captured: MinerLedgers | undefined;
    const provider = buildReplayCorpusProvider({
      gate1Dir,
      stage4: stage4({ 'src/a.ts': 'forbiddenCall()' }),
      now: NOW,
      onLedgers: (l) => {
        captured = l;
      },
    });

    const corpus = await provider(lockWith(hash, prDiffsHash(), groundTruthHash()));

    expect(corpus.rules).toHaveLength(1);
    expect(corpus.provenanceByRule.get(corpus.rules[0]!.lessonHash)?.mergedPr).toBe(1);
    // fold-I ledgers emitted via the sink.
    expect(captured?.apiUsage.heldOutFetchCount).toBe(0);
  });

  it('throws loud when the lock lacks the L2 llmReplaySha (no integrity gate)', async () => {
    const provider = buildReplayCorpusProvider({
      gate1Dir,
      stage4: stage4({ 'src/a.ts': 'forbiddenCall()' }),
      now: NOW,
    });
    await expect(provider(lockWith(undefined))).rejects.toThrow(/llmReplaySha/);
  });

  it('writes the fold-I miner ledgers to the gate-1 dir by default', async () => {
    const hash = await fixtureHash();
    const provider = buildReplayCorpusProvider({
      gate1Dir,
      stage4: stage4({ 'src/a.ts': 'forbiddenCall()' }),
      now: NOW,
    });
    await provider(lockWith(hash, prDiffsHash(), groundTruthHash()));
    expect(fs.existsSync(path.join(gate1Dir, 'miner-ledgers.json'))).toBe(true);
  });

  it('throws loud when the lock lacks the prDiffsSha digest (#2225 scoring-source gate)', async () => {
    const hash = await fixtureHash();
    const provider = buildReplayCorpusProvider({
      gate1Dir,
      stage4: stage4({ 'src/a.ts': 'forbiddenCall()' }),
      now: NOW,
    });
    // llmReplaySha present, prDiffsSha omitted → the fold-2 gate fires.
    await expect(provider(lockWith(hash, undefined))).rejects.toThrow(/prDiffsSha/);
  });

  it('throws loud when pr-diffs.json is tampered after freeze (#2225 fold-2)', async () => {
    const hash = await fixtureHash();
    const lock = lockWith(hash, prDiffsHash(), groundTruthHash()); // digests captured over the frozen bytes
    // a schema-valid but byte-different scoring source — passes Zod, fails the digest.
    // (pr-diffs is verified BEFORE ground-truth in the loader, so this fires first.)
    fs.writeFileSync(
      path.join(gate1Dir, 'pr-diffs.json'),
      JSON.stringify([{ pr: 1, diff: 'tampered', controlKind: 'corpus' }]),
      'utf-8',
    );
    const provider = buildReplayCorpusProvider({
      gate1Dir,
      stage4: stage4({ 'src/a.ts': 'forbiddenCall()' }),
      now: NOW,
    });
    await expect(provider(lock)).rejects.toThrow(/pr-diffs\.json integrity/);
  });

  it('throws loud when the lock lacks the groundTruthSha digest (#709 5d-iii-ii answer-key gate)', async () => {
    const hash = await fixtureHash();
    const provider = buildReplayCorpusProvider({
      gate1Dir,
      stage4: stage4({ 'src/a.ts': 'forbiddenCall()' }),
      now: NOW,
    });
    // llmReplaySha + prDiffsSha present, groundTruthSha omitted → the run-path answer-key
    // gate fires (the precondition is ordered after prDiffsSha, so the prDiffsSha-only
    // tests above still trip their own error).
    await expect(provider(lockWith(hash, prDiffsHash(), undefined))).rejects.toThrow(
      /groundTruthSha/,
    );
  });

  it('throws loud when ground-truth-labels.json is tampered after freeze (#709 5d-iii-ii)', async () => {
    const hash = await fixtureHash();
    const lock = lockWith(hash, prDiffsHash(), groundTruthHash()); // digest captured over `{}`
    // a schema-valid but byte-different answer key — passes Zod (firingLabelId → TP), fails
    // the digest. pr-diffs stays intact so the ground-truth gate (read second) is what fires.
    fs.writeFileSync(
      path.join(gate1Dir, 'ground-truth-labels.json'),
      JSON.stringify({ 'abc123:src/a.ts:1': 'TP' }),
      'utf-8',
    );
    const provider = buildReplayCorpusProvider({
      gate1Dir,
      stage4: stage4({ 'src/a.ts': 'forbiddenCall()' }),
      now: NOW,
    });
    await expect(provider(lock)).rejects.toThrow(/ground-truth-labels\.json integrity/);
  });
});
