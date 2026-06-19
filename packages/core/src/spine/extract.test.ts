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
/**
 * Non-empty, but makes `extractManualPattern` THROW a TotemParseError (a yaml
 * `**Pattern:**` fence under a non-`ast-grep` engine). The preflight's catch
 * converts that to a drop, never a propagated throw.
 */
const PARSER_THROW_DSL = [
  '**Pattern:**',
  '```yaml',
  'rule:',
  '  pattern: foo',
  '```',
  '**Engine:** regex',
].join('\n');

function content(pr: number, overrides?: Partial<ReviewThreadContent>): ReviewThreadContent {
  return {
    pr,
    mergeCommitSha: sha(pr),
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
 * standard thread). Async — mirrors the network-IO port shape.
 */
function spySource(
  trainPrs: number[],
  results?: Map<number, FetchResult>,
): ReviewThreadSource & { fetched: number[] } {
  const trainSet = new Set(trainPrs);
  const fetched: number[] = [];
  return {
    fetched,
    async fetch(pr: number): Promise<FetchResult> {
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

/** Fixture extractor: per-PR draft bodies from a map (default: one usable body). Async. */
function fixtureExtractor(byPr?: Map<number, string[]>): DraftExtractor {
  return {
    async draft(c: ReviewThreadContent): Promise<string[]> {
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

// A single-train-PR split (PR 1), the rest held-out — for per-drop-code fixtures.
const solo = () =>
  split({ trainPrs: [1], heldOutPrs: [2, 3, 4], positiveControlPrs: [3], negativeControlPrs: [4] });

// ─── Happy path ─────────────────────────────────────────────────────────────

describe('runExtractStage — happy path', () => {
  it('emits one draft per train PR with complete provenance and clean ledgers', async () => {
    const r = await runExtractStage(split(), deps(spySource([1, 2]), fixtureExtractor()));

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

  it('iterates the train slice in deterministic ascending order', async () => {
    const source = spySource([2, 1]); // train listed out of order
    await runExtractStage(
      split({ trainPrs: [2, 1], heldOutPrs: [3, 4] }),
      deps(source, fixtureExtractor()),
    );
    expect(source.fetched).toEqual([1, 2]);
  });
});

// ─── Drop reason codes (one red fixture per code) ────────────────────────────

describe('runExtractStage — drop reason codes', () => {
  it('unreachable: source reports the thread never fetched', async () => {
    const r = await runExtractStage(
      solo(),
      deps(spySource([1], new Map([[1, { kind: 'unreachable' }]])), fixtureExtractor()),
    );
    expect(dropsFor(r, 1)).toEqual([
      expect.objectContaining({ sourcePr: 1, reasonCode: 'unreachable' }),
    ]);
    expect(r.drafts).toEqual([]);
  });

  it('unparseable (at source): a fetched-but-unparseable thread', async () => {
    const r = await runExtractStage(
      solo(),
      deps(spySource([1], new Map([[1, { kind: 'unparseable' }]])), fixtureExtractor()),
    );
    expect(dropsFor(r, 1)[0]!.reasonCode).toBe('unparseable');
  });

  it('truncated: an empty thread (no comments)', async () => {
    const r = await runExtractStage(
      solo(),
      deps(
        spySource([1], new Map([[1, { kind: 'ok', content: content(1, { threads: [] }) }]])),
        fixtureExtractor(),
      ),
    );
    expect(dropsFor(r, 1)[0]!.reasonCode).toBe('truncated');
  });

  it('truncated: a bot-only thread does not satisfy ≥1 human comment (fold 5)', async () => {
    const botThread = content(1, {
      threads: [
        { path: 'x.ts', comments: [{ author: 'coderabbitai[bot]', body: 'nit: rename this' }] },
      ],
    });
    const r = await runExtractStage(
      solo(),
      deps(spySource([1], new Map([[1, { kind: 'ok', content: botThread }]])), fixtureExtractor()),
    );
    expect(dropsFor(r, 1)[0]!.reasonCode).toBe('truncated');
  });

  it('truncated: a whitespace-only human comment counts as no comment', async () => {
    const wsThread = content(1, {
      threads: [{ path: 'x.ts', comments: [{ author: 'Jane Doe', body: '   ' }] }],
    });
    const r = await runExtractStage(
      solo(),
      deps(spySource([1], new Map([[1, { kind: 'ok', content: wsThread }]])), fixtureExtractor()),
    );
    expect(dropsFor(r, 1)[0]!.reasonCode).toBe('truncated');
  });

  it('incomplete-provenance: a malformed merge-commit SHA', async () => {
    const badSha = content(1, { mergeCommitSha: 'NOTASHA' });
    const r = await runExtractStage(
      solo(),
      deps(spySource([1], new Map([[1, { kind: 'ok', content: badSha }]])), fixtureExtractor()),
    );
    expect(dropsFor(r, 1)[0]!.reasonCode).toBe('incomplete-provenance');
    expect(r.drafts).toEqual([]);
  });

  it('incomplete-provenance: fetched content for the wrong PR is a loud drop (CR-3)', async () => {
    const mismatched = content(2); // content says PR 2, but PR 1 was requested
    const r = await runExtractStage(
      solo(),
      deps(spySource([1], new Map([[1, { kind: 'ok', content: mismatched }]])), fixtureExtractor()),
    );
    expect(dropsFor(r, 1)[0]!.reasonCode).toBe('incomplete-provenance');
    expect(dropsFor(r, 1)[0]!.detail).toContain('does not match');
    expect(r.drafts).toEqual([]);
  });

  it('unparseable: a non-empty draft with no usable **Pattern:** (fold 4 preflight)', async () => {
    const r = await runExtractStage(
      solo(),
      deps(spySource([1]), fixtureExtractor(new Map([[1, [NO_PATTERN_DSL]]]))),
    );
    expect(dropsFor(r, 1)[0]!.reasonCode).toBe('unparseable');
    expect(r.drafts).toEqual([]);
  });

  it('unparseable: a draft that makes the parser throw is converted to a drop, not propagated (CR-2)', async () => {
    const r = await runExtractStage(
      solo(),
      deps(spySource([1]), fixtureExtractor(new Map([[1, [PARSER_THROW_DSL]]]))),
    );
    expect(dropsFor(r, 1)[0]!.reasonCode).toBe('unparseable');
    expect(r.drafts).toEqual([]);
  });

  it('unparseable: the extractor produced no draft from a complete thread', async () => {
    const r = await runExtractStage(
      solo(),
      deps(spySource([1]), fixtureExtractor(new Map([[1, []]]))),
    );
    expect(dropsFor(r, 1)[0]!.reasonCode).toBe('unparseable');
  });

  it('a contract-violating extractor throw propagates (fail-loud, not swallowed)', async () => {
    // The port contract is: return [] on a per-PR failure (the CLI adapter catches
    // its own IO errors). A throw VIOLATES that contract and must NOT be silently
    // swallowed — it propagates (Tenet 4). Per-PR resilience is the adapter's job;
    // the []-returns path is covered by "extractor produced no draft" above.
    const throwingExtractor: DraftExtractor = {
      async draft(c) {
        if (c.pr === 1) throw new Error('boom');
        return [USABLE_DSL];
      },
    };
    await expect(
      runExtractStage(split(), deps(spySource([1, 2]), throwingExtractor)),
    ).rejects.toThrow('boom');
  });
});

// ─── FM(i) slice-2 half: N-draft / M-drop accounting (fold 1) ─────────────────

describe('runExtractStage — FM(i) slice-2 accounting (at-least-one, list-shaped)', () => {
  it('a single PR may yield N drafts', async () => {
    const r = await runExtractStage(
      solo(),
      deps(spySource([1]), fixtureExtractor(new Map([[1, [USABLE_DSL, USABLE_DSL]]]))),
    );
    expect(r.drafts).toHaveLength(2);
    expect(r.drafts.every((d) => d.provenance.mergedPr === 1)).toBe(true);
  });

  it('a single PR may yield a draft AND a drop', async () => {
    const r = await runExtractStage(
      solo(),
      deps(spySource([1]), fixtureExtractor(new Map([[1, [USABLE_DSL, NO_PATTERN_DSL]]]))),
    );
    expect(r.drafts).toHaveLength(1);
    expect(dropsFor(r, 1)).toHaveLength(1);
    expect(dropsFor(r, 1)[0]!.reasonCode).toBe('unparseable');
  });

  it('every train PR is creditable: draftCount + dropCount >= 1 (none silently skipped)', async () => {
    // PR 1 drafts, PR 2 is unreachable (drop-only) — both covered.
    const r = await runExtractStage(
      split(),
      deps(spySource([1, 2], new Map([[2, { kind: 'unreachable' }]])), fixtureExtractor()),
    );
    expect(coveredPrs(r)).toEqual(new Set([1, 2]));
  });

  it('the coverage check has teeth — a PR in neither drafts nor drops is detectable', async () => {
    const r = await runExtractStage(split(), deps(spySource([1, 2]), fixtureExtractor()));
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
  it('the spy source hard-fails if a non-train PR is fetched', async () => {
    const source = spySource([1, 2]);
    await expect(source.fetch(3)).rejects.toThrow(/non-train PR 3/);
  });

  it('never fetches a held-out / control / excluded PR; heldOutFetchCount stays 0', async () => {
    const source = spySource([1, 2]);
    const r = await runExtractStage(
      split({ trainPrs: [1, 2], heldOutPrs: [3, 4], excludedPrs: [] }),
      deps(source, fixtureExtractor()),
    );
    expect(source.fetched).toEqual([1, 2]); // only train PRs touched
    expect(r.apiUsageLedger.entries.map((e) => e.targetPr).sort()).toEqual([1, 2]);
    expect(r.apiUsageLedger.heldOutFetchCount).toBe(0);
  });

  it('heldOutFetchCount is derived from the frozen split, not a trusted label', async () => {
    // Every logged entry targets a train PR → recomputed count is 0 regardless.
    const r = await runExtractStage(split(), deps(spySource([1, 2]), fixtureExtractor()));
    const recomputed = r.apiUsageLedger.entries.filter((e) => ![1, 2].includes(e.targetPr)).length;
    expect(recomputed).toBe(r.apiUsageLedger.heldOutFetchCount);
  });
});

// ─── Seed-blindness (FM f, carried in-run) ────────────────────────────────────

describe('runExtractStage — seed-blindness', () => {
  it('carries seedClassesProvided=false through to the result', async () => {
    const r = await runExtractStage(split(), deps(spySource([1, 2]), fixtureExtractor(), false));
    expect(r.seedBlindness.seedClassesProvided).toBe(false);
  });

  it('faithfully carries a violated attestation (slice 3 / the harness asserts it)', async () => {
    const r = await runExtractStage(split(), deps(spySource([1, 2]), fixtureExtractor(), true));
    expect(r.seedBlindness.seedClassesProvided).toBe(true);
  });
});

// ─── Determinism ──────────────────────────────────────────────────────────────

describe('runExtractStage — determinism', () => {
  it('identical inputs + fixed deps produce identical output', async () => {
    const run = () =>
      runExtractStage(
        split(),
        deps(
          spySource([1, 2], new Map([[2, { kind: 'unreachable' }]])),
          fixtureExtractor(new Map([[1, [USABLE_DSL, NO_PATTERN_DSL]]])),
        ),
      );
    expect(await run()).toEqual(await run());
  });
});
