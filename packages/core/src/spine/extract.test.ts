import { describe, expect, it } from 'vitest';

import {
  type DraftExtractor,
  type ExtractStageResult,
  type FetchResult,
  type ReviewThreadContent,
  type ReviewThreadSource,
  runExtractStage,
} from './extract.js';
import { type SplitArtifact, SplitArtifactSchema } from './split.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

const sha = (n: number): string => String(n).padStart(40, '0');

function split(overrides?: Partial<SplitArtifact>): SplitArtifact {
  return SplitArtifactSchema.parse({
    asOfCommit: sha(100),
    trainPrs: [1, 2],
    heldOutPrs: [3, 4],
    excludedPrs: [],
    positiveControlPrs: [3],
    negativeControlPrs: [4],
    splitRule: { predicate: 'code-touching non-bot', cutIndex: 2 },
    ...overrides,
  });
}

/** A usable lesson-markdown body (flat `**Pattern:**`) — passes the preflight. */
const USABLE_DSL = '**Pattern:** foo';
/** Non-empty, but no usable `**Pattern:**` — fails the preflight → `unparseable`. */
const NO_PATTERN_DSL = 'This is just prose with no pattern field.';

function content(pr: number, overrides?: Partial<ReviewThreadContent>): ReviewThreadContent {
  return {
    pr,
    headCommitSha: sha(pr),
    threads: [
      {
        path: 'packages/core/src/x.ts',
        comments: [{ author: 'Jane Doe', body: 'a real review note' }],
      },
    ],
    ...overrides,
  };
}

/**
 * Strict-spy fetch source (fold 6): throws if asked for a non-train PR, records
 * what it fetched, and serves a per-PR `FetchResult` (default: ok with a
 * standard thread).
 */
function spySource(
  trainPrs: number[],
  results?: Map<number, FetchResult>,
): ReviewThreadSource & { fetched: number[] } {
  const trainSet = new Set(trainPrs);
  const fetched: number[] = [];
  return {
    fetched,
    fetch(pr: number): FetchResult {
      if (!trainSet.has(pr)) {
        throw new Error(
          `[Totem Error] Extractor violated train boundary: fetched non-train PR ${pr}`,
        );
      }
      fetched.push(pr);
      return results?.get(pr) ?? { kind: 'ok', content: content(pr) };
    },
  };
}

/** Fixture extractor: per-PR draft bodies from a map (default: one usable body). */
function fixtureExtractor(byPr?: Map<number, string[]>): DraftExtractor {
  return {
    draft(c: ReviewThreadContent): string[] {
      return byPr?.get(c.pr) ?? [USABLE_DSL];
    },
  };
}

const deps = (
  source: ReviewThreadSource,
  extractor: DraftExtractor,
  seedClassesProvided = false,
) => ({
  source,
  extractor,
  seedClassesProvided,
});

const coveredPrs = (r: ExtractStageResult): Set<number> =>
  new Set([
    ...r.drafts.map((d) => d.provenance.mergedPr),
    ...r.dropLedger.entries.map((e) => e.sourcePr),
  ]);

const dropsFor = (r: ExtractStageResult, pr: number) =>
  r.dropLedger.entries.filter((e) => e.sourcePr === pr);

// ─── Happy path ─────────────────────────────────────────────────────────────

describe('runExtractStage — happy path', () => {
  it('emits one draft per train PR with complete provenance and clean ledgers', () => {
    const r = runExtractStage(split(), deps(spySource([1, 2]), fixtureExtractor()));

    expect(r.drafts).toHaveLength(2);
    expect(r.drafts.map((d) => d.provenance.mergedPr).sort()).toEqual([1, 2]);
    expect(r.drafts[0]!.provenance).toEqual({
      mergedPr: 1,
      reviewThread: 'pulls/1/comments',
      commitSha: sha(1),
    });
    expect(r.drafts[0]!.dslSource).toBe(USABLE_DSL);

    expect(r.dropLedger.entries).toEqual([]);
    expect(r.apiUsageLedger.entries).toHaveLength(2);
    expect(r.apiUsageLedger.entries.every((e) => e.slice === 'train')).toBe(true);
    expect(r.apiUsageLedger.heldOutFetchCount).toBe(0);
  });

  it('iterates the train slice in deterministic ascending order', () => {
    const source = spySource([2, 1]); // train listed out of order
    runExtractStage(
      split({ trainPrs: [2, 1], heldOutPrs: [3, 4] }),
      deps(source, fixtureExtractor()),
    );
    expect(source.fetched).toEqual([1, 2]);
  });
});

// ─── Drop reason codes (one red fixture per code) ────────────────────────────

describe('runExtractStage — drop reason codes', () => {
  it('unreachable: source reports the thread never fetched', () => {
    const r = runExtractStage(
      split({
        trainPrs: [1],
        heldOutPrs: [2, 3, 4],
        positiveControlPrs: [3],
        negativeControlPrs: [4],
      }),
      deps(spySource([1], new Map([[1, { kind: 'unreachable' }]])), fixtureExtractor()),
    );
    expect(dropsFor(r, 1)).toEqual([
      expect.objectContaining({ sourcePr: 1, reasonCode: 'unreachable' }),
    ]);
    expect(r.drafts).toEqual([]);
  });

  it('unparseable (at source): a fetched-but-unparseable thread', () => {
    const r = runExtractStage(
      split({
        trainPrs: [1],
        heldOutPrs: [2, 3, 4],
        positiveControlPrs: [3],
        negativeControlPrs: [4],
      }),
      deps(spySource([1], new Map([[1, { kind: 'unparseable' }]])), fixtureExtractor()),
    );
    expect(dropsFor(r, 1)[0]!.reasonCode).toBe('unparseable');
  });

  it('truncated: an empty thread (no comments)', () => {
    const r = runExtractStage(
      split({
        trainPrs: [1],
        heldOutPrs: [2, 3, 4],
        positiveControlPrs: [3],
        negativeControlPrs: [4],
      }),
      deps(
        spySource([1], new Map([[1, { kind: 'ok', content: content(1, { threads: [] }) }]])),
        fixtureExtractor(),
      ),
    );
    expect(dropsFor(r, 1)[0]!.reasonCode).toBe('truncated');
  });

  it('truncated: a bot-only thread does not satisfy ≥1 human comment (fold 5)', () => {
    const botThread = content(1, {
      threads: [
        { path: 'x.ts', comments: [{ author: 'coderabbitai[bot]', body: 'nit: rename this' }] },
      ],
    });
    const r = runExtractStage(
      split({
        trainPrs: [1],
        heldOutPrs: [2, 3, 4],
        positiveControlPrs: [3],
        negativeControlPrs: [4],
      }),
      deps(spySource([1], new Map([[1, { kind: 'ok', content: botThread }]])), fixtureExtractor()),
    );
    expect(dropsFor(r, 1)[0]!.reasonCode).toBe('truncated');
  });

  it('truncated: a whitespace-only human comment counts as no comment', () => {
    const wsThread = content(1, {
      threads: [{ path: 'x.ts', comments: [{ author: 'Jane Doe', body: '   ' }] }],
    });
    const r = runExtractStage(
      split({
        trainPrs: [1],
        heldOutPrs: [2, 3, 4],
        positiveControlPrs: [3],
        negativeControlPrs: [4],
      }),
      deps(spySource([1], new Map([[1, { kind: 'ok', content: wsThread }]])), fixtureExtractor()),
    );
    expect(dropsFor(r, 1)[0]!.reasonCode).toBe('truncated');
  });

  it('incomplete-provenance: a malformed merge-commit SHA', () => {
    const badSha = content(1, { headCommitSha: 'NOTASHA' });
    const r = runExtractStage(
      split({
        trainPrs: [1],
        heldOutPrs: [2, 3, 4],
        positiveControlPrs: [3],
        negativeControlPrs: [4],
      }),
      deps(spySource([1], new Map([[1, { kind: 'ok', content: badSha }]])), fixtureExtractor()),
    );
    expect(dropsFor(r, 1)[0]!.reasonCode).toBe('incomplete-provenance');
    expect(r.drafts).toEqual([]);
  });

  it('unparseable: a non-empty draft with no usable **Pattern:** (fold 4 preflight)', () => {
    const r = runExtractStage(
      split({
        trainPrs: [1],
        heldOutPrs: [2, 3, 4],
        positiveControlPrs: [3],
        negativeControlPrs: [4],
      }),
      deps(spySource([1]), fixtureExtractor(new Map([[1, [NO_PATTERN_DSL]]]))),
    );
    expect(dropsFor(r, 1)[0]!.reasonCode).toBe('unparseable');
    expect(r.drafts).toEqual([]);
  });

  it('unparseable: the extractor produced no draft from a complete thread', () => {
    const r = runExtractStage(
      split({
        trainPrs: [1],
        heldOutPrs: [2, 3, 4],
        positiveControlPrs: [3],
        negativeControlPrs: [4],
      }),
      deps(spySource([1]), fixtureExtractor(new Map([[1, []]]))),
    );
    expect(dropsFor(r, 1)[0]!.reasonCode).toBe('unparseable');
  });

  it('unparseable: a thrown extractor is a loud per-PR drop, not a run abort', () => {
    const throwingExtractor: DraftExtractor = {
      draft(c) {
        if (c.pr === 1) throw new Error('boom');
        return [USABLE_DSL];
      },
    };
    const r = runExtractStage(split(), deps(spySource([1, 2]), throwingExtractor));
    expect(dropsFor(r, 1)[0]!.reasonCode).toBe('unparseable');
    expect(dropsFor(r, 1)[0]!.detail).toContain('extractor threw');
    // PR 2 still processes — the run did not abort.
    expect(r.drafts.map((d) => d.provenance.mergedPr)).toEqual([2]);
  });
});

// ─── FM(i) slice-2 half: N-draft / M-drop accounting (fold 1) ─────────────────

describe('runExtractStage — FM(i) slice-2 accounting (at-least-one, list-shaped)', () => {
  it('a single PR may yield N drafts', () => {
    const r = runExtractStage(
      split({
        trainPrs: [1],
        heldOutPrs: [2, 3, 4],
        positiveControlPrs: [3],
        negativeControlPrs: [4],
      }),
      deps(spySource([1]), fixtureExtractor(new Map([[1, [USABLE_DSL, USABLE_DSL]]]))),
    );
    expect(r.drafts).toHaveLength(2);
    expect(r.drafts.every((d) => d.provenance.mergedPr === 1)).toBe(true);
  });

  it('a single PR may yield a draft AND a drop', () => {
    const r = runExtractStage(
      split({
        trainPrs: [1],
        heldOutPrs: [2, 3, 4],
        positiveControlPrs: [3],
        negativeControlPrs: [4],
      }),
      deps(spySource([1]), fixtureExtractor(new Map([[1, [USABLE_DSL, NO_PATTERN_DSL]]]))),
    );
    expect(r.drafts).toHaveLength(1);
    expect(dropsFor(r, 1)).toHaveLength(1);
    expect(dropsFor(r, 1)[0]!.reasonCode).toBe('unparseable');
  });

  it('every train PR is creditable: draftCount + dropCount >= 1 (none silently skipped)', () => {
    // PR 1 drafts, PR 2 is unreachable (drop-only) — both covered.
    const r = runExtractStage(
      split(),
      deps(spySource([1, 2], new Map([[2, { kind: 'unreachable' }]])), fixtureExtractor()),
    );
    expect(coveredPrs(r)).toEqual(new Set([1, 2]));
  });

  it('the coverage check has teeth — a PR in neither drafts nor drops is detectable', () => {
    const r = runExtractStage(split(), deps(spySource([1, 2]), fixtureExtractor()));
    expect(coveredPrs(r)).toEqual(new Set([1, 2]));
    // Simulate a silent skip of PR 2; the FM(i) coverage check flags it.
    const doctored: ExtractStageResult = {
      ...r,
      drafts: r.drafts.filter((d) => d.provenance.mergedPr !== 2),
      dropLedger: { entries: r.dropLedger.entries.filter((e) => e.sourcePr !== 2) },
    };
    const missing = [1, 2].filter((pr) => !coveredPrs(doctored).has(pr));
    expect(missing).toEqual([2]);
  });
});

// ─── Train-only fetch boundary (FM h, fold 6) ─────────────────────────────────

describe('runExtractStage — train-only fetch boundary', () => {
  it('the spy source hard-fails if a non-train PR is fetched', () => {
    const source = spySource([1, 2]);
    expect(() => source.fetch(3)).toThrow(/non-train PR 3/);
  });

  it('never fetches a held-out / control / excluded PR; heldOutFetchCount stays 0', () => {
    const source = spySource([1, 2]);
    const r = runExtractStage(
      split({ trainPrs: [1, 2], heldOutPrs: [3, 4], excludedPrs: [] }),
      deps(source, fixtureExtractor()),
    );
    expect(source.fetched).toEqual([1, 2]); // only train PRs touched
    expect(r.apiUsageLedger.entries.map((e) => e.targetPr).sort()).toEqual([1, 2]);
    expect(r.apiUsageLedger.heldOutFetchCount).toBe(0);
  });

  it('heldOutFetchCount is derived from the frozen split, not a trusted label', () => {
    // Every logged entry targets a train PR → recomputed count is 0 regardless.
    const r = runExtractStage(split(), deps(spySource([1, 2]), fixtureExtractor()));
    const recomputed = r.apiUsageLedger.entries.filter((e) => ![1, 2].includes(e.targetPr)).length;
    expect(recomputed).toBe(r.apiUsageLedger.heldOutFetchCount);
  });
});

// ─── Seed-blindness (FM f, carried in-run) ────────────────────────────────────

describe('runExtractStage — seed-blindness', () => {
  it('carries seedClassesProvided=false through to the result', () => {
    const r = runExtractStage(split(), deps(spySource([1, 2]), fixtureExtractor(), false));
    expect(r.seedBlindness.seedClassesProvided).toBe(false);
  });

  it('faithfully carries a violated attestation (slice 3 / the harness asserts it)', () => {
    const r = runExtractStage(split(), deps(spySource([1, 2]), fixtureExtractor(), true));
    expect(r.seedBlindness.seedClassesProvided).toBe(true);
  });
});

// ─── Determinism ──────────────────────────────────────────────────────────────

describe('runExtractStage — determinism', () => {
  it('identical inputs + fixed deps produce identical output', () => {
    const run = () =>
      runExtractStage(
        split(),
        deps(
          spySource([1, 2], new Map([[2, { kind: 'unreachable' }]])),
          fixtureExtractor(new Map([[1, [USABLE_DSL, NO_PATTERN_DSL]]])),
        ),
      );
    expect(run()).toEqual(run());
  });
});
