import { describe, expect, it } from 'vitest';

import {
  assembleMinerLedgers,
  type ClassifierResult,
  type ClassifyStageResult,
  dispositionToRouting,
  type DraftClassifier,
  runClassifyStage,
} from './classify.js';
import type { DraftCandidate, ExtractStageResult } from './extract.js';
import type { DraftSourceKind, MinerLedgers, SplitLedger } from './ledgers.js';
import { type FmClause, runFalsificationHarness } from './miner-harness.js';

const sha = (n: number): string => String(n).padStart(40, '0');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function draft(
  pr: number,
  dslSource: string,
  sourceKind: DraftSourceKind = 'human',
): DraftCandidate {
  return {
    provenance: { mergedPr: pr, reviewThread: `rt-${pr}`, commitSha: sha(pr) },
    dslSource,
    sourceKind,
  };
}

const STRUCT = '**Pattern:** no-foo'; // marker the dsl-keyed fixture classifier reads as structural
const BEHAVE = 'prefer X over Y (a behavioral lesson)';

const asStructural: ClassifierResult = {
  disposition: 'structural',
  dispositionSource: 'classified',
};
const asBehavioral: ClassifierResult = {
  disposition: 'behavioral',
  dispositionSource: 'classified',
};
const asErrorDefault: ClassifierResult = {
  disposition: 'behavioral',
  dispositionSource: 'error-default',
};

function classifierBy(fn: (d: DraftCandidate) => ClassifierResult): DraftClassifier {
  return { classify: (d) => Promise.resolve(fn(d)) };
}
const always = (r: ClassifierResult): DraftClassifier => classifierBy(() => r);
/** Classify by a marker in the dsl body — structural iff it carries a `**Pattern:**`. */
const markerClassifier = classifierBy((d) =>
  d.dslSource.includes('Pattern:') ? asStructural : asBehavioral,
);

/** A frozen split ledger: train [1,2], heldOut [3,4] (controls 3/4), corpus [1..4]. */
function splitLedger(): SplitLedger {
  return {
    split: {
      asOfCommit: sha(100),
      trainPrs: [1, 2],
      heldOutPrs: [3, 4],
      excludedPrs: [],
      positiveControlPrs: [3],
      negativeControlPrs: [4],
      splitRule: { predicate: 'code-touching non-bot', cutIndex: 2 },
    },
    corpus: [1, 2, 3, 4],
    corpusMergeCommits: [1, 2, 3, 4].map((pr) => ({ pr, mergeCommit: sha(pr) })),
  };
}

/** A slice-2 Extract result: train fetches derived from the drafts, no held-out fetch. */
function extractResult(opts: {
  drafts: DraftCandidate[];
  seed?: boolean;
  drops?: ExtractStageResult['dropLedger']['entries'];
}): ExtractStageResult {
  const fetchedPrs = [...new Set(opts.drafts.map((d) => d.provenance.mergedPr))].sort(
    (a, b) => a - b,
  );
  return {
    drafts: opts.drafts,
    dropLedger: { entries: opts.drops ?? [] },
    apiUsageLedger: {
      entries: fetchedPrs.map((pr) => ({
        targetPr: pr,
        slice: 'train' as const,
        fetchKind: 'review-thread',
      })),
      heldOutFetchCount: 0,
    },
    seedBlindness: { seedClassesProvided: opts.seed ?? false },
  };
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const clauses = (raw: unknown): FmClause[] =>
  [...new Set(runFalsificationHarness(raw).violations.map((v) => v.clause))].sort();

// ── dispositionToRouting ────────────────────────────────────────────────────

describe('dispositionToRouting', () => {
  it('maps structural → compile and behavioral → rag-only', () => {
    expect(dispositionToRouting('structural')).toBe('compile');
    expect(dispositionToRouting('behavioral')).toBe('rag-only');
  });
});

// ── Mint fidelity + ledgers ──────────────────────────────────────────────────

describe('runClassifyStage — mint + ledgers', () => {
  it('mints a structural candidate: compile routing, classified ledger entry, unverified, verbatim carry', async () => {
    const d = draft(1, STRUCT);
    const r = await runClassifyStage(extractResult({ drafts: [d] }), splitLedger(), {
      classifier: always(asStructural),
    });

    expect(r.candidates).toHaveLength(1);
    const c = r.candidates[0];
    expect(c.classifierDisposition).toBe('structural');
    expect(c.unverified).toBe(true);
    expect(c.dslSource).toBe(STRUCT); // byte-verbatim
    expect(c.provenance).toEqual(d.provenance); // byte-verbatim
    expect(c.classifierLedgerRef).toBe('clr-1-0');

    expect(r.emissionLedger.entries).toEqual([
      {
        candidateRef: 'cand-1-0',
        provenance: d.provenance,
        classifierDisposition: 'structural',
        routing: 'compile',
        classifierLedgerRef: 'clr-1-0',
        unverified: true,
        sourceKind: 'human', // slice β: carried from the draft (default human here)
      },
    ]);
    expect(r.classifierLedger.entries).toEqual([
      {
        candidateRef: 'clr-1-0',
        disposition: 'structural',
        stage4Confirmed: false,
        dispositionSource: 'classified',
      },
    ]);
  });

  it('mints a behavioral candidate with rag-only routing (never compiled)', async () => {
    const r = await runClassifyStage(extractResult({ drafts: [draft(1, BEHAVE)] }), splitLedger(), {
      classifier: always(asBehavioral),
    });
    expect(r.candidates[0].classifierDisposition).toBe('behavioral');
    expect(r.emissionLedger.entries[0].routing).toBe('rag-only');
  });

  it('slice β: the draft sourceKind is serialized onto its emission row (panel OQ-β4)', async () => {
    const r = await runClassifyStage(
      extractResult({
        drafts: [draft(1, STRUCT, 'bot'), draft(2, BEHAVE, 'mixed')],
      }),
      splitLedger(),
      { classifier: always(asStructural) },
    );
    expect(r.emissionLedger.entries.map((e) => e.sourceKind)).toEqual(['bot', 'mixed']);
  });

  it('join holds: every emission classifierLedgerRef resolves to a classifier entry with the same disposition', async () => {
    const r = await runClassifyStage(
      extractResult({ drafts: [draft(1, STRUCT), draft(2, BEHAVE)] }),
      splitLedger(),
      { classifier: markerClassifier },
    );
    const byRef = new Map(r.classifierLedger.entries.map((e) => [e.candidateRef, e]));
    for (const e of r.emissionLedger.entries) {
      const attesting = byRef.get(e.classifierLedgerRef);
      expect(attesting).toBeDefined();
      expect(attesting?.disposition).toBe(e.classifierDisposition);
    }
  });

  it('threads the run-level seed-blindness fact from Extract into the emission ledger (single home)', async () => {
    const blind = await runClassifyStage(
      extractResult({ drafts: [draft(1, STRUCT)] }),
      splitLedger(),
      {
        classifier: always(asStructural),
      },
    );
    expect(blind.emissionLedger.extractionInputsAttestation.seedClassesProvided).toBe(false);

    const seeded = await runClassifyStage(
      extractResult({ drafts: [draft(1, STRUCT)], seed: true }),
      splitLedger(),
      { classifier: always(asStructural) },
    );
    expect(seeded.emissionLedger.extractionInputsAttestation.seedClassesProvided).toBe(true);
  });
});

// ── 1:1 minting, refs, no dedup ──────────────────────────────────────────────

describe('runClassifyStage — 1:1 minting + deterministic refs', () => {
  it('mints N distinct candidates from one PR with distinct refs and NO dslSource dedup', async () => {
    // Two drafts from PR 1 with IDENTICAL dslSource must stay two distinct candidates.
    const r = await runClassifyStage(
      extractResult({ drafts: [draft(1, STRUCT), draft(1, STRUCT)] }),
      splitLedger(),
      { classifier: always(asStructural) },
    );
    expect(r.candidates).toHaveLength(2);
    expect(r.emissionLedger.entries.map((e) => e.candidateRef)).toEqual(['cand-1-0', 'cand-1-1']);
    expect(r.classifierLedger.entries.map((e) => e.candidateRef)).toEqual(['clr-1-0', 'clr-1-1']);
    // No dedup: both carry the identical dslSource.
    expect(r.candidates.every((c) => c.dslSource === STRUCT)).toBe(true);
  });

  it('keeps 1:1 across drafts: candidates == emission == classifier == drafts', async () => {
    const drafts = [draft(1, STRUCT), draft(1, BEHAVE), draft(2, STRUCT)];
    const r = await runClassifyStage(extractResult({ drafts }), splitLedger(), {
      classifier: markerClassifier,
    });
    expect(r.candidates).toHaveLength(drafts.length);
    expect(r.emissionLedger.entries).toHaveLength(drafts.length);
    expect(r.classifierLedger.entries).toHaveLength(drafts.length);
  });

  it('emits empty ledgers (attestation present) when there are no drafts', async () => {
    const r = await runClassifyStage(extractResult({ drafts: [] }), splitLedger(), {
      classifier: always(asStructural),
    });
    expect(r.candidates).toEqual([]);
    expect(r.emissionLedger.entries).toEqual([]);
    expect(r.classifierLedger.entries).toEqual([]);
    expect(r.emissionLedger.extractionInputsAttestation).toEqual({ seedClassesProvided: false });
  });
});

// ── Safe-default + error contracts ───────────────────────────────────────────

describe('runClassifyStage — safe-default + fail-loud error contracts', () => {
  it('records a safe-default behavioral as error-default and NEVER compile-routes it', async () => {
    const r = await runClassifyStage(extractResult({ drafts: [draft(1, STRUCT)] }), splitLedger(), {
      classifier: always(asErrorDefault),
    });
    expect(r.candidates[0].classifierDisposition).toBe('behavioral');
    expect(r.emissionLedger.entries[0].routing).toBe('rag-only');
    expect(r.classifierLedger.entries[0].dispositionSource).toBe('error-default');
    // The low-privilege guarantee: a failed classification is never structural/compile.
    expect(r.emissionLedger.entries[0].routing).not.toBe('compile');
  });

  it('propagates a contract-violating classifier throw loudly (no core swallow)', async () => {
    const throwing: DraftClassifier = {
      classify: async () => {
        throw new Error('classifier adapter boom');
      },
    };
    await expect(
      runClassifyStage(extractResult({ drafts: [draft(1, STRUCT)] }), splitLedger(), {
        classifier: throwing,
      }),
    ).rejects.toThrow('classifier adapter boom');
  });

  it('fails loud on a non-enum classifier result BEFORE routing/mint', async () => {
    const bogus: DraftClassifier = {
      classify: () =>
        Promise.resolve({
          disposition: 'sideways',
          dispositionSource: 'classified',
        } as unknown as ClassifierResult),
    };
    await expect(
      runClassifyStage(extractResult({ drafts: [draft(1, STRUCT)] }), splitLedger(), {
        classifier: bogus,
      }),
    ).rejects.toThrow();
  });

  it('rejects an error-default paired with a structural disposition (safe-default must be low-privilege)', async () => {
    // A buggy adapter must not be able to compile-route a failure default: the
    // ClassifierResultSchema refine rejects `{ structural, error-default }` before routing.
    const inconsistent: DraftClassifier = {
      classify: () =>
        Promise.resolve({ disposition: 'structural', dispositionSource: 'error-default' }),
    };
    await expect(
      runClassifyStage(extractResult({ drafts: [draft(1, STRUCT)] }), splitLedger(), {
        classifier: inconsistent,
      }),
    ).rejects.toThrow();
  });
});

// ── Fail-loud provenance re-check (FM(e-emission) at the stage boundary) ──────

describe('runClassifyStage — fail-loud provenance re-check', () => {
  it('throws on a draft sourced from a non-train PR (forged/leaked draft)', async () => {
    await expect(
      runClassifyStage(extractResult({ drafts: [draft(99, STRUCT)] }), splitLedger(), {
        classifier: always(asStructural),
      }),
    ).rejects.toThrow(/not in the frozen train slice/);
  });

  it('throws on a draft whose commitSha does not match the PR frozen merge commit', async () => {
    const forged: DraftCandidate = {
      provenance: { mergedPr: 1, reviewThread: 'rt-1', commitSha: sha(99) },
      dslSource: STRUCT,
      sourceKind: 'human',
    };
    await expect(
      runClassifyStage(extractResult({ drafts: [forged] }), splitLedger(), {
        classifier: always(asStructural),
      }),
    ).rejects.toThrow(/frozen merge commit/);
  });

  it('throws when the split ledger has no frozen merge commit for a train PR (unvalidated cover)', async () => {
    // Cover-validity is the harness's job, not the SplitLedger schema's — so a caller
    // can hand in a SplitLedger whose corpusMergeCommits omits a train PR. The stage
    // must fail loud rather than mint a candidate with no frozen-SHA anchor.
    const sl = splitLedger();
    const holey: SplitLedger = {
      ...sl,
      corpusMergeCommits: sl.corpusMergeCommits.filter((e) => e.pr !== 1),
    };
    await expect(
      runClassifyStage(extractResult({ drafts: [draft(1, STRUCT)] }), holey, {
        classifier: always(asStructural),
      }),
    ).rejects.toThrow(/no frozen merge commit/);
  });
});

// ── Determinism ──────────────────────────────────────────────────────────────

describe('runClassifyStage — determinism', () => {
  it('produces identical output for identical inputs + a fixed classifier', async () => {
    const drafts = [draft(1, STRUCT), draft(2, BEHAVE), draft(1, BEHAVE)];
    const r1 = await runClassifyStage(extractResult({ drafts }), splitLedger(), {
      classifier: markerClassifier,
    });
    const r2 = await runClassifyStage(extractResult({ drafts }), splitLedger(), {
      classifier: markerClassifier,
    });
    expect(r1).toEqual(r2);
  });
});

// ── End-to-end: real producer output through the §8 harness ──────────────────

describe('assembleMinerLedgers + harness — real producer output', () => {
  async function greenAssembled(seed = false): Promise<MinerLedgers> {
    const sl = splitLedger();
    // Cover BOTH train PRs (1 structural, 2 behavioral) so FM(i) is satisfied.
    const extract = extractResult({ drafts: [draft(1, STRUCT), draft(2, BEHAVE)], seed });
    const classify: ClassifyStageResult = await runClassifyStage(extract, sl, {
      classifier: markerClassifier,
    });
    return assembleMinerLedgers(sl, extract, classify);
  }

  it('a real extract+classify run is contract-clean (no FM clause holds)', async () => {
    const r = runFalsificationHarness(await greenAssembled());
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('a seeded run trips FM(f) end-to-end (real serialized attestation)', async () => {
    expect(clauses(await greenAssembled(true))).toEqual(['f']);
  });

  it('tampering a behavioral candidate to compile-route trips FM(c)', async () => {
    const t = clone(await greenAssembled());
    (t.emission.entries[1] as { routing: string }).routing = 'compile'; // PR2 is behavioral
    expect(clauses(t)).toEqual(['c']);
  });

  it('a candidate forged onto a held-out PR trips FM(e-emission)', async () => {
    const t = clone(await greenAssembled());
    t.emission.entries.push({
      candidateRef: 'cand-3-0',
      provenance: { mergedPr: 3, reviewThread: 'rt-3', commitSha: sha(3) }, // PR 3 is held-out
      classifierDisposition: 'structural',
      routing: 'compile',
      classifierLedgerRef: 'clr-3-0',
      unverified: true,
    });
    t.classifier.entries.push({
      candidateRef: 'clr-3-0',
      disposition: 'structural',
      stage4Confirmed: false,
      dispositionSource: 'classified',
    });
    expect(clauses(t)).toEqual(['e-emission']);
  });

  it('dropping a train PR from emission (no drop) trips FM(i)', async () => {
    const t = clone(await greenAssembled());
    t.emission.entries.splice(1, 1); // remove the PR 2 candidate without dropping it
    expect(clauses(t)).toEqual(['i']);
  });

  it('a malformed real ledger maps to FM(a) (incomplete provenance) and FM(b) (non-unverified)', async () => {
    const a = clone(await greenAssembled());
    delete (a.emission.entries[0].provenance as Record<string, unknown>).commitSha;
    expect(clauses(a)).toContain('a');

    const b = clone(await greenAssembled());
    (b.emission.entries[0] as { unverified: boolean }).unverified = false;
    expect(clauses(b)).toContain('b');
  });
});
