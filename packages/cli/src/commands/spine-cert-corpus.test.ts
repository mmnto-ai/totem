import { describe, expect, it } from 'vitest';

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

import { buildCertifyingCorpus, type BuildCertifyingCorpusDeps } from './spine-cert-corpus.js';

// ─── Fixtures (mirrors the slice-2/3/4 stage tests) ───

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

function fakeSource(): ReviewThreadSource {
  return {
    async fetch(pr: number): Promise<FetchResult> {
      return { kind: 'ok', content: content(pr) };
    },
  };
}

function fakeExtractor(dsls: string[]): DraftExtractor {
  return {
    async draft() {
      return dsls.length === 0 ? { drafts: dsls, noDraftCause: 'all-filtered' } : { drafts: dsls };
    },
  };
}

function fakeClassifier(disposition: 'structural' | 'behavioral' = 'structural'): DraftClassifier {
  return {
    async classify(): Promise<ClassifierResult> {
      return { disposition, dispositionSource: 'classified' };
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

function stage4(files: Record<string, string>): Stage4VerifierDeps {
  return {
    listFiles: () => Promise.resolve(Object.keys(files)),
    readFile: (f: string) =>
      f in files ? Promise.resolve(files[f] as string) : Promise.reject(new Error(`absent ${f}`)),
  };
}

function baseDeps(overrides: Partial<BuildCertifyingCorpusDeps> = {}): BuildCertifyingCorpusDeps {
  return {
    split: SPLIT,
    splitLedger: SPLIT_LEDGER,
    source: fakeSource(),
    extractor: fakeExtractor([REGEX_DSL]),
    classifier: fakeClassifier(),
    seedClassesProvided: false,
    stage4: stage4({ 'src/a.ts': 'forbiddenCall()' }),
    now: NOW,
    prDiffs: [],
    groundTruth: new Map(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────

describe('buildCertifyingCorpus', () => {
  it('composes extract→classify→compile into a corpus (rules + provenanceByRule + fold-I ledgers)', async () => {
    const { corpus, ledgers } = await buildCertifyingCorpus(baseDeps());

    expect(corpus.rules).toHaveLength(1);
    const rule = corpus.rules[0]!;
    // provenanceByRule maps the survivor to its mining provenance (train PR 1).
    const prov = corpus.provenanceByRule.get(rule.lessonHash);
    expect(prov).toBeDefined();
    expect(prov!.mergedPr).toBe(1);

    // fold-I: held-out fetch count is 0 (FM-h) + seed-blindness surfaced.
    expect(ledgers.apiUsage.heldOutFetchCount).toBe(0);
    expect(ledgers.emission.extractionInputsAttestation.seedClassesProvided).toBe(false);
  });

  it('binding-2: a Stage-4 out-of-scope (archived) rule is EXCLUDED from the scored set', async () => {
    // The rule fires only on a TEST file → Stage-4 out-of-scope → status archived →
    // must not reach the scored set (archived ≠ wind-tunnel FP; fold-F would throw).
    const { corpus } = await buildCertifyingCorpus(
      baseDeps({ stage4: stage4({ 'src/a.test.ts': 'forbiddenCall()' }) }),
    );
    expect(corpus.rules).toHaveLength(0);
    expect(corpus.provenanceByRule.size).toBe(0);
  });

  it('a behavioral candidate is routed rag-only (never compiled into the scored set)', async () => {
    const { corpus } = await buildCertifyingCorpus(
      baseDeps({ classifier: fakeClassifier('behavioral') }),
    );
    expect(corpus.rules).toHaveLength(0);
  });
});
