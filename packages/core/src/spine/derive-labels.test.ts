import { describe, expect, it } from 'vitest';

import type { CorpusDisposition, CorpusDispositionThread } from './corpus-dispositions.js';
import { deriveLabelsFromDispositions } from './derive-labels.js';
import type { RuleFiring } from './windtunnel-scorer.js';

// ─── builders ────────────────────────────────────────

function firing(over: Partial<RuleFiring> & Pick<RuleFiring, 'labelId'>): RuleFiring {
  return {
    ruleId: 'rule-a',
    pr: 1,
    filePath: 'src/a.ts',
    matchedLine: 'forbiddenCall()',
    controlKind: 'corpus',
    ...over,
  };
}

function thread(over: Partial<CorpusDispositionThread>): CorpusDispositionThread {
  return {
    path: 'src/a.ts',
    diffHunk: '@@ -1,2 +1,3 @@\n context();\n+forbiddenCall()',
    isResolved: false,
    isOutdated: false,
    comments: [{ author: 'Jane', body: 'fixed' }],
    ...over,
  };
}

function disposition(pr: number, threads: CorpusDispositionThread[]): CorpusDisposition {
  return { pr, mergeCommitSha: String(pr).padStart(40, '0'), threads };
}

// ─── span-join: added-line-only binding (codex hard fold) ────────────────────

describe('deriveLabelsFromDispositions — span-join (added-line-only)', () => {
  it('binds a corpus firing to a disposition via an ADDED (+) hunk row', () => {
    const { labels, diagnostics } = deriveLabelsFromDispositions(
      [firing({ labelId: 'L1' })],
      [disposition(1, [thread({})])],
    );
    expect(labels['L1']).toBe('TP'); // 'fixed' → accepted-fix → TP
    expect(diagnostics.boundCorpusFirings).toBe(1);
  });

  it('does NOT bind to a CONTEXT row (leading space) — context-only ⟹ no label', () => {
    const { labels, diagnostics } = deriveLabelsFromDispositions(
      [firing({ labelId: 'L1' })],
      // same text present ONLY as a context row — never as an added row.
      [disposition(1, [thread({ diffHunk: '@@ -1,2 +1,2 @@\n context();\n forbiddenCall()' })])],
    );
    expect(labels['L1']).toBeUndefined();
    expect(diagnostics.unlabeledByReason['no-matching-disposition']).toBe(1);
  });

  it('binds via the ADDED row even when the same text also appears as a context row', () => {
    const { labels } = deriveLabelsFromDispositions(
      [firing({ labelId: 'L1' })],
      [
        disposition(1, [
          thread({ diffHunk: '@@ -1,3 +1,4 @@\n forbiddenCall()\n-old()\n+forbiddenCall()' }),
        ]),
      ],
    );
    expect(labels['L1']).toBe('TP');
  });

  it('ignores a +++ file header that coincidentally matches the line', () => {
    const { labels, diagnostics } = deriveLabelsFromDispositions(
      [firing({ labelId: 'L1', matchedLine: '+ b/forbiddenCall()' })],
      [disposition(1, [thread({ diffHunk: '+++ b/forbiddenCall()\n context();' })])],
    );
    expect(labels['L1']).toBeUndefined();
    expect(diagnostics.unlabeledByReason['no-matching-disposition']).toBe(1);
  });

  it('does NOT bind across files (path mismatch) even on identical added content', () => {
    const { labels } = deriveLabelsFromDispositions(
      [firing({ labelId: 'L1', filePath: 'src/a.ts' })],
      [disposition(1, [thread({ path: 'src/other.ts' })])],
    );
    expect(labels['L1']).toBeUndefined();
  });

  it('matches trailing-whitespace-drifted content (mirrors normalizeMatchedLine)', () => {
    const { labels } = deriveLabelsFromDispositions(
      [firing({ labelId: 'L1', matchedLine: 'forbiddenCall()' })],
      // the added row carries trailing whitespace; the bind must still hold.
      [disposition(1, [thread({ diffHunk: '@@ -1,1 +1,2 @@\n+forbiddenCall()   ' })])],
    );
    expect(labels['L1']).toBe('TP');
  });
});

// ─── ambiguity never labels (codex: 0 or >1 ⟹ omit) ──────────────────────────

describe('deriveLabelsFromDispositions — ambiguity', () => {
  it('omits when ZERO dispositions bind', () => {
    const { labels, diagnostics } = deriveLabelsFromDispositions(
      [firing({ labelId: 'L1', pr: 99 })],
      [disposition(1, [thread({})])],
    );
    expect(labels['L1']).toBeUndefined();
    expect(diagnostics.unlabeledByReason['no-matching-disposition']).toBe(1);
  });

  it('omits when MORE THAN ONE disposition binds (ambiguous)', () => {
    const { labels, diagnostics } = deriveLabelsFromDispositions(
      [firing({ labelId: 'L1' })],
      [
        disposition(1, [
          thread({}),
          thread({ comments: [{ author: 'Jo', body: 'false positive' }] }),
        ]),
      ],
    );
    expect(labels['L1']).toBeUndefined();
    expect(diagnostics.unlabeledByReason['ambiguous-multiple-dispositions']).toBe(1);
  });
});

// ─── taxonomy projection (5d-i) ──────────────────────────────────────────────

describe('deriveLabelsFromDispositions — taxonomy projection', () => {
  it('accepted-fix ⟹ TP, declined-as-false-positive ⟹ FP, soft-decline ⟹ UNLABELED', () => {
    const { labels, diagnostics } = deriveLabelsFromDispositions(
      [
        firing({ labelId: 'TPf', pr: 1, filePath: 'src/a.ts' }),
        firing({ labelId: 'FPf', pr: 2, filePath: 'src/b.ts' }),
        firing({ labelId: 'UNf', pr: 3, filePath: 'src/c.ts' }),
      ],
      [
        disposition(1, [thread({ comments: [{ author: 'Jane', body: 'fixed' }] })]),
        disposition(2, [
          thread({
            path: 'src/b.ts',
            comments: [{ author: 'Jane', body: 'this is a false positive' }],
          }),
        ]),
        disposition(3, [
          thread({
            path: 'src/c.ts',
            comments: [{ author: 'Jane', body: 'out of scope for this PR' }],
          }),
        ]),
      ],
    );
    expect(labels['TPf']).toBe('TP');
    expect(labels['FPf']).toBe('FP');
    expect(labels['UNf']).toBeUndefined(); // soft decline routes to UNLABELED
    expect(diagnostics.unlabeledByReason['unlabeled-class']).toBe(1);
  });
});

// ─── control kinds ───────────────────────────────────────────────────────────

describe('deriveLabelsFromDispositions — control kinds', () => {
  it('negative-control firings never label (the scorer culls)', () => {
    const { labels, diagnostics } = deriveLabelsFromDispositions(
      [firing({ labelId: 'N1', controlKind: 'negative' })],
      [],
    );
    expect(labels['N1']).toBeUndefined();
    expect(diagnostics.negativeFirings).toBe(1);
  });

  it('positive-control: TP ONLY for the declared (pr,targetRuleId) target; incidental omitted', () => {
    const { labels, diagnostics } = deriveLabelsFromDispositions(
      [
        // declared target: ruleId === targetRuleId ⟹ structural TP
        firing({ labelId: 'PT', controlKind: 'positive', pr: 5, ruleId: 'R1', targetRuleId: 'R1' }),
        // incidental: a different rule fired on the positive fixture ⟹ omit + report
        firing({ labelId: 'PI', controlKind: 'positive', pr: 5, ruleId: 'R2', targetRuleId: 'R1' }),
      ],
      [],
    );
    expect(labels['PT']).toBe('TP');
    expect(labels['PI']).toBeUndefined();
    expect(diagnostics.unlabeledByReason['incidental-positive']).toBe(1);
    expect(diagnostics.positiveFirings).toBe(2);
  });
});

// ─── diagnostics + evidence ──────────────────────────────────────────────────

describe('deriveLabelsFromDispositions — diagnostics + evidence', () => {
  it('reports density, per-rule counts, evidence-refs, and is deterministic', () => {
    const firings: RuleFiring[] = [
      firing({ labelId: 'a', ruleId: 'rule-x', pr: 1, filePath: 'src/a.ts' }),
      firing({ labelId: 'b', ruleId: 'rule-x', pr: 2, filePath: 'src/b.ts' }), // unbound
    ];
    const dispositions = [
      disposition(1, [
        thread({ threadId: 'T_abc', comments: [{ commentId: 42, author: 'Jane', body: 'fixed' }] }),
      ]),
    ];
    const first = deriveLabelsFromDispositions(firings, dispositions);
    const second = deriveLabelsFromDispositions(firings, dispositions);

    expect(first).toEqual(second); // deterministic
    expect(first.diagnostics.corpusFirings).toBe(2);
    expect(first.diagnostics.boundCorpusFirings).toBe(1);
    expect(first.diagnostics.dispositionDensity).toBe(0.5);
    expect(first.diagnostics.labelCounts).toEqual({ TP: 1, FP: 0 });
    expect(first.diagnostics.perRuleLabeled['rule-x']).toEqual({ TP: 1, FP: 0 });
    // evidence-ref links the emitted label back to its disposition source (audit).
    expect(first.evidence).toHaveLength(1);
    expect(first.evidence[0]).toMatchObject({
      labelId: 'a',
      label: 'TP',
      threadId: 'T_abc',
      commentId: 42,
      source: 'corpus-disposition',
    });
    // the answer key carries ONLY TP|FP values (no evidence leaks into the hashed key).
    expect(Object.values(first.labels)).toEqual(['TP']);
  });

  it('density is 0 (not NaN) when there are no corpus firings', () => {
    const { diagnostics } = deriveLabelsFromDispositions(
      [firing({ labelId: 'N', controlKind: 'negative' })],
      [],
    );
    expect(diagnostics.dispositionDensity).toBe(0);
    expect(diagnostics.unlabeledRate).toBe(0);
  });
});
