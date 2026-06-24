import { describe, expect, it } from 'vitest';

import {
  classifyAuthorKind,
  type DraftExtractor,
  type DraftResult,
  type ExtractStageResult,
  type FetchResult,
  type ReviewThread,
  type ReviewThreadComment,
  type ReviewThreadContent,
  type ReviewThreadSource,
  runExtractStage,
} from './extract.js';
import { normalizeReviewChrome } from './review-normalize.js';
import { type SplitArtifact, SplitArtifactSchema } from './split.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

const sha = (n: number): string => String(n).padStart(40, '0');

/**
 * Build a slice-β-enriched comment exactly as the CLI mapping boundary does:
 * `authorKind` via core `classifyAuthorKind`, `normalizedBody` = de-chromed for a
 * recognized review bot, else the raw body. Keeps test comments honest w.r.t. the
 * shipped classification rather than hand-stamping fields.
 */
function comment(author: string, body: string): ReviewThreadComment {
  const authorKind = classifyAuthorKind(author);
  return {
    author,
    body,
    authorKind,
    normalizedBody: authorKind === 'bot' ? normalizeReviewChrome(body) : body,
  };
}

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
        comments: [comment('Jane Doe', 'a real review note')],
        isResolved: false,
        isOutdated: false,
      },
    ],
    ...overrides,
  };
}

/** A review thread with explicit resolution flags (default: eligible). */
function thread(
  author: string,
  body: string,
  flags?: { isResolved?: boolean; isOutdated?: boolean },
): ReviewThread {
  return {
    path: 'packages/core/src/x.ts',
    comments: [comment(author, body)],
    isResolved: flags?.isResolved ?? false,
    isOutdated: flags?.isOutdated ?? false,
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

/**
 * Fixture extractor: per-PR draft bodies from a map (default: one usable body). Async.
 * Wraps the bare `string[]` into a `DraftResult`, tagging an empty list with a
 * representative `all-filtered` cause so the "cause iff empty" invariant holds.
 */
function fixtureExtractor(byPr?: Map<number, string[]>): DraftExtractor {
  return {
    async draft(c: ReviewThreadContent): Promise<DraftResult> {
      const drafts = byPr?.get(c.pr) ?? [USABLE_DSL];
      return drafts.length === 0 ? { drafts, noDraftCause: 'all-filtered' } : { drafts };
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

  it('truncated: a NOISE-bot-only thread does not satisfy ≥1 substantive comment (slice β denylist)', async () => {
    // dependabot/renovate are NOT in the review-finding allowlist → still excluded
    // (unlike gemini/CR, which now count — see the slice-β substrate tests).
    const botThread = content(1, {
      threads: [
        {
          path: 'x.ts',
          comments: [comment('dependabot[bot]', 'bump lodash to 4.17.21')],
          isResolved: false,
          isOutdated: false,
        },
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
      threads: [
        {
          path: 'x.ts',
          comments: [comment('Jane Doe', '   ')],
          isResolved: false,
          isOutdated: false,
        },
      ],
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

  it('no-draft: the extractor produced no draft from a complete thread — records cause + sourceKind (slice β)', async () => {
    const r = await runExtractStage(
      solo(),
      deps(spySource([1]), fixtureExtractor(new Map([[1, []]]))),
    );
    const drop = dropsFor(r, 1)[0]!;
    // Slice β: the zero-draft drop is now its own `no-draft` reason code (was the
    // misnamed `unparseable`), with the precise sub-cause + the substrate tag.
    expect(drop.reasonCode).toBe('no-draft');
    // The Tenet-19 diagnostic is carried onto the drop (fixtureExtractor tags an
    // empty list 'all-filtered') — never silently dropped as a bare [].
    expect(drop.noDraftCause).toBe('all-filtered');
    expect(drop.detail).toContain('all-filtered');
    // The default `content(1)` thread is a single human comment → human substrate.
    expect(drop.sourceKind).toBe('human');
  });

  it('boundary-parse fails loud on a contract-violating DraftResult (empty-without-cause)', async () => {
    // A buggy adapter returning { drafts: [] } with no cause violates the
    // "cause iff empty" invariant; DraftResultSchema.parse must reject it at the
    // core boundary (Tenet 4), not silently drop-ledger a causeless empty.
    const badExtractor: DraftExtractor = {
      async draft(): Promise<DraftResult> {
        // Type-VALID (noDraftCause is optional in the static type) but RUNTIME-invalid:
        // the schema's "cause iff empty" refine requires a cause when drafts is empty,
        // so the core boundary parse rejects this — exactly the buggy-adapter case.
        return { drafts: [] };
      },
    };
    await expect(runExtractStage(solo(), deps(spySource([1]), badExtractor))).rejects.toThrow(
      /noDraftCause must be present iff drafts is empty/,
    );
  });

  it('a contract-violating extractor throw propagates (fail-loud, not swallowed)', async () => {
    // The port contract is: return { drafts: [], noDraftCause } on a per-PR failure
    // (the CLI adapter catches its own IO errors → 'invoke-error'). A throw VIOLATES
    // that contract and must NOT be silently swallowed — it propagates (Tenet 4).
    // Per-PR resilience is the adapter's job; the empty-result path is covered by
    // "extractor produced no draft" above.
    const throwingExtractor: DraftExtractor = {
      async draft(c) {
        if (c.pr === 1) throw new Error('boom');
        return { drafts: [USABLE_DSL] };
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

// ─── Resolution-eligibility gate (slice 5a, mmnto-ai/totem#2201) ──────────────

/** A fixture extractor that records the content it was handed (to assert filtering). */
function recordingExtractor(byPr?: Map<number, string[]>): DraftExtractor & {
  seen: ReviewThreadContent[];
} {
  const seen: ReviewThreadContent[] = [];
  return {
    seen,
    async draft(c: ReviewThreadContent): Promise<DraftResult> {
      seen.push(c);
      const drafts = byPr?.get(c.pr) ?? [USABLE_DSL];
      return drafts.length === 0 ? { drafts, noDraftCause: 'all-filtered' } : { drafts };
    },
  };
}

describe('runExtractStage — eligibility gate (slice γ: RESOLVED admitted, only OUTDATED excluded)', () => {
  it('a RESOLVED thread is now ADMITTED (drafts; reaches the extractor input)', async () => {
    const resolved = content(1, {
      threads: [thread('Jane Doe', 'a real review note', { isResolved: true })],
    });
    const extractor = recordingExtractor();
    const r = await runExtractStage(
      solo(),
      deps(spySource([1], new Map([[1, { kind: 'ok', content: resolved }]])), extractor),
    );
    expect(r.drafts).toHaveLength(1);
    expect(dropsFor(r, 1)).toEqual([]);
    // γ: the resolved thread is no longer pre-filtered — the extractor saw it.
    expect(extractor.seen[0]!.threads).toHaveLength(1);
    expect(extractor.seen[0]!.threads[0]!.isResolved).toBe(true);
  });

  it('all-OUTDATED-but-had-substantive-content drops outdated-rejected (not truncated)', async () => {
    const allOutdated = content(1, {
      threads: [
        thread('Jane Doe', 'a real review note', { isOutdated: true }),
        thread('John Roe', 'another note', { isOutdated: true }),
      ],
    });
    const r = await runExtractStage(
      solo(),
      deps(
        spySource([1], new Map([[1, { kind: 'ok', content: allOutdated }]])),
        fixtureExtractor(),
      ),
    );
    const drop = dropsFor(r, 1)[0]!;
    expect(drop.reasonCode).toBe('outdated-rejected');
    expect(drop.detail).toContain('2 of 2 threads outdated');
    expect(drop.detail).toContain('0 eligible substantive comments remain');
    expect(r.drafts).toEqual([]);
  });

  it('thin-to-begin-with (0 substantive comments before the gate) stays truncated, not outdated-rejected', async () => {
    // A noise-bot-only outdated thread — the gate is not what emptied it; it was
    // already thin (dependabot is not a recognized review bot). Keep `truncated`.
    const botOutdated = content(1, {
      threads: [thread('dependabot[bot]', 'bump dep', { isOutdated: true })],
    });
    const r = await runExtractStage(
      solo(),
      deps(
        spySource([1], new Map([[1, { kind: 'ok', content: botOutdated }]])),
        fixtureExtractor(),
      ),
    );
    expect(dropsFor(r, 1)[0]!.reasonCode).toBe('truncated');
  });

  it('partial: OUTDATED threads excluded from the draft input; resolved + fresh survive', async () => {
    const mixed = content(1, {
      threads: [
        thread('Jane Doe', 'eligible note A'),
        thread('John Roe', 'resolved note B', { isResolved: true }),
        thread('Kate Poe', 'outdated note C', { isOutdated: true }),
      ],
    });
    const extractor = recordingExtractor();
    const r = await runExtractStage(
      solo(),
      deps(spySource([1], new Map([[1, { kind: 'ok', content: mixed }]])), extractor),
    );
    expect(r.drafts).toHaveLength(1);
    expect(dropsFor(r, 1)).toEqual([]);
    // The extractor saw the two NON-outdated threads (incl. the resolved one); only
    // the outdated thread was excluded (γ inverts the slice-5a resolved exclusion).
    const seenThreads = extractor.seen[0]!.threads;
    expect(seenThreads).toHaveLength(2);
    expect(seenThreads.every((t) => !t.isOutdated)).toBe(true);
    expect(seenThreads.map((t) => t.comments[0]!.body).sort()).toEqual([
      'eligible note A',
      'resolved note B',
    ]);
  });

  it('a fully-eligible thread is unaffected by the gate (no regression)', async () => {
    const r = await runExtractStage(solo(), deps(spySource([1]), fixtureExtractor()));
    expect(r.drafts).toHaveLength(1);
    expect(dropsFor(r, 1)).toEqual([]);
  });
});

// ─── Slice β: bot-review substrate + sourceKind diagnostic ────────────────────

describe('runExtractStage — slice β (bot-review substrate + sourceKind)', () => {
  it('a RECOGNIZED review-bot (coderabbitai) comment now COUNTS as substrate → drafts', async () => {
    const crOnly = content(1, {
      threads: [thread('coderabbitai[bot]', 'Potential issue: guard against NaN here')],
    });
    const r = await runExtractStage(
      solo(),
      deps(spySource([1], new Map([[1, { kind: 'ok', content: crOnly }]])), fixtureExtractor()),
    );
    expect(r.drafts).toHaveLength(1);
    expect(dropsFor(r, 1)).toEqual([]);
    expect(r.drafts[0]!.sourceKind).toBe('bot');
  });

  it('gemini-code-assist (no [bot] suffix) counts as substrate', async () => {
    const gca = content(1, {
      threads: [thread('gemini-code-assist', 'require is_finite() before the divide')],
    });
    const r = await runExtractStage(
      solo(),
      deps(spySource([1], new Map([[1, { kind: 'ok', content: gca }]])), fixtureExtractor()),
    );
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]!.sourceKind).toBe('bot');
  });

  it('sourceKind is human for a human-only thread', async () => {
    const r = await runExtractStage(solo(), deps(spySource([1]), fixtureExtractor()));
    expect(r.drafts[0]!.sourceKind).toBe('human');
  });

  it('a badge-ONLY review-bot comment is NOT substantive — de-chromed empty → truncated, not no-draft (greptile #2242)', async () => {
    const badgeOnly = content(1, {
      threads: [thread('coderabbitai[bot]', '![high](https://x/high.svg)')],
    });
    const r = await runExtractStage(
      solo(),
      deps(spySource([1], new Map([[1, { kind: 'ok', content: badgeOnly }]])), fixtureExtractor()),
    );
    // normalizedBody strips to '' → not substantive → thin from the start.
    expect(dropsFor(r, 1)[0]!.reasonCode).toBe('truncated');
    expect(r.drafts).toEqual([]);
  });

  it('sourceKind is mixed when human + review-bot comments both survive', async () => {
    const mixed = content(1, {
      threads: [
        thread('Jane Doe', 'the human rationale'),
        thread('coderabbitai[bot]', 'the bot finding'),
      ],
    });
    const r = await runExtractStage(
      solo(),
      deps(spySource([1], new Map([[1, { kind: 'ok', content: mixed }]])), fixtureExtractor()),
    );
    expect(r.drafts[0]!.sourceKind).toBe('mixed');
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

  it('identical inputs are deterministic across the eligibility gate (drafts + drops + ledgers)', async () => {
    // PR 1: a partial mix (resolved + fresh both survive → a draft).
    // PR 2: all-outdated-but-had-substantive-content → an outdated-rejected drop.
    const pr1 = content(1, {
      threads: [
        thread('Jane Doe', 'eligible note', { isResolved: false }),
        thread('John Roe', 'resolved note', { isResolved: true }),
      ],
    });
    const pr2 = content(2, {
      threads: [thread('Kate Poe', 'a real note', { isOutdated: true })],
    });
    const run = () =>
      runExtractStage(
        split(),
        deps(
          spySource(
            [1, 2],
            new Map([
              [1, { kind: 'ok', content: pr1 }],
              [2, { kind: 'ok', content: pr2 }],
            ]),
          ),
          fixtureExtractor(),
        ),
      );
    const a = await run();
    const b = await run();
    expect(a).toEqual(b);
    expect(dropsFor(a, 2)[0]!.reasonCode).toBe('outdated-rejected');
  });
});
