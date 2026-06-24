import * as net from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  ClassifierResult,
  DraftClassifier,
  DraftExtractor,
  FetchResult,
  ReviewThreadContent,
  ReviewThreadSource,
  SplitArtifact,
  SplitLedger,
  Stage4VerifierDeps,
} from '@mmnto/totem';

import { buildCertifyingCorpus } from './spine-cert-corpus.js';
import { buildReplayAdapters, recordReplayFixture } from './spine-cert-record.js';
import type { ReplayProvenance } from './spine-llm-replay.js';

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

function content(pr: number): ReviewThreadContent {
  return {
    pr,
    mergeCommitSha: sha(pr),
    threads: [
      {
        path: 'src/a.ts',
        comments: [{ author: 'Jane', body: 'note', authorKind: 'human', normalizedBody: 'note' }],
        isResolved: false,
        isOutdated: false,
      },
    ],
  };
}

function frozenSource(): ReviewThreadSource {
  return {
    async fetch(pr: number): Promise<FetchResult> {
      return { kind: 'ok', content: content(pr) };
    },
  };
}

function liveExtractor(): DraftExtractor {
  return {
    async draft() {
      return { drafts: [REGEX_DSL] };
    },
  };
}

function liveClassifier(): DraftClassifier {
  return {
    async classify(): Promise<ClassifierResult> {
      return { disposition: 'structural', dispositionSource: 'classified' };
    },
  };
}

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

function stage4(): Stage4VerifierDeps {
  const files: Record<string, string> = { 'src/a.ts': 'forbiddenCall()' };
  return {
    listFiles: () => Promise.resolve(Object.keys(files)),
    readFile: (f: string) =>
      f in files ? Promise.resolve(files[f] as string) : Promise.reject(new Error(`absent ${f}`)),
  };
}

/** Record a replay fixture from the live fakes (the artifact the cert run replays). */
async function freezeFixture() {
  return recordReplayFixture({
    split: SPLIT,
    splitLedger: SPLIT_LEDGER,
    source: frozenSource(),
    liveExtractor: liveExtractor(),
    liveClassifier: liveClassifier(),
    seedClassesProvided: false,
    provenance: PROVENANCE,
  });
}

function replayCorpus(
  artifact: Awaited<ReturnType<typeof freezeFixture>>['artifact'],
  hash: string,
) {
  const { extractor, classifier } = buildReplayAdapters(artifact, hash);
  return buildCertifyingCorpus({
    split: SPLIT,
    splitLedger: SPLIT_LEDGER,
    source: frozenSource(),
    extractor,
    classifier,
    seedClassesProvided: false,
    stage4: stage4(),
    now: NOW,
    prDiffs: [],
    groundTruth: new Map(),
  });
}

// ─── fold-K: E2E replay round-trip under network isolation ───

describe('5c-ii cert run — replay round-trip + TCP isolation (fold-K)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replays the recorded fixture into a faithful corpus (record→freeze→replay round-trip)', async () => {
    const { artifact, hash } = await freezeFixture();
    const { corpus } = await replayCorpus(artifact, hash);

    expect(corpus.rules).toHaveLength(1);
    const rule = corpus.rules[0]!;
    expect(corpus.provenanceByRule.get(rule.lessonHash)?.mergedPr).toBe(1);
  });

  it('the replay path makes ZERO outgoing network calls (fold-K TCP block)', async () => {
    const { artifact, hash } = await freezeFixture();

    // Block every outgoing TCP/fetch — the replay corpus build must complete
    // without tripping either guard (zero-LLM, zero-network by construction).
    const netConnect = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation((() => {
      throw new Error('fold-K violation: outgoing TCP connect attempted during replay');
    }) as unknown as typeof net.Socket.prototype.connect);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((() => {
      throw new Error('fold-K violation: fetch attempted during replay');
    }) as unknown as typeof fetch);

    const { corpus } = await replayCorpus(artifact, hash);

    expect(corpus.rules).toHaveLength(1);
    expect(netConnect).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a wrong expected-hash trips the integrity gate before any replay (loud fixture failure)', async () => {
    const { artifact } = await freezeFixture();
    // L2: the lock-wired hash must match the artifact; a stale/tampered one fails loud.
    expect(() => buildReplayAdapters(artifact, sha(99))).toThrow();
  });
});
