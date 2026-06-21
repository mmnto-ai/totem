import { describe, expect, it } from 'vitest';

import type { CompiledRule, Legitimacy, ProvenanceRecord } from '../compiler-schema.js';
import { buildCertifiedRulesFile, projectLegitimacy } from './legitimacy-projection.js';
import type { PerRuleControlResult } from './windtunnel-firing.js';
import type { WindtunnelVerdict, WindtunnelVerdictKind } from './windtunnel-scorer.js';

// ─── Fixtures ────────────────────────────────────────

const COMMIT = 'a'.repeat(40);

function provenance(mergedPr = 100): ProvenanceRecord {
  return { mergedPr, reviewThread: `pr#${mergedPr}/thread-1`, commitSha: COMMIT };
}

function makeRule(lessonHash: string, overrides: Partial<CompiledRule> = {}): CompiledRule {
  return {
    lessonHash,
    lessonHeading: `Rule ${lessonHash}`,
    pattern: 'debugger',
    message: 'no debugger',
    engine: 'regex',
    compiledAt: '2026-06-20T00:00:00.000Z',
    ...overrides,
  };
}

function makeVerdict(kind: WindtunnelVerdictKind): WindtunnelVerdict {
  return {
    verdict: kind,
    precision: kind === 'PASS' ? 1.0 : null,
    mintedRuleCount: 1,
    culledCount: 0,
    survivingRuleCount: 1,
    exposureTuple: [2, 1, 1],
    cullLedger: [],
    nonVacuity: kind === 'PASS',
    needsAdjudication: [],
    diagnostics: { survivorPrecision: kind === 'PASS' ? 1.0 : null },
  };
}

function control(positiveControl: boolean, negativeControl = true): PerRuleControlResult {
  return { positiveControl, negativeControl, evidenceRefs: [] };
}

// ─── fold-B: legitimacy projection ───────────────────

describe('projectLegitimacy (fold-B)', () => {
  it('PASS + both controls ⟹ legitimacy {true,true}, ruleClass hard, unverified false', () => {
    const result = projectLegitimacy({
      verdict: makeVerdict('PASS'),
      perRuleControls: new Map([['r1', control(true, true)]]),
      candidates: [makeRule('r1')],
      provenanceByRule: new Map([['r1', provenance()]]),
    });
    expect(result.stamped).toHaveLength(1);
    const stamped = result.stamped[0]!;
    expect(stamped.legitimacy).toEqual<Legitimacy>({
      provenance: provenance(),
      positiveControl: true,
      negativeControl: true,
    });
    expect(stamped.ruleClass).toBe('hard');
    expect(stamped.unverified).toBe(false);
    expect(result.skips).toHaveLength(0);
  });

  it('PASS + positiveControl FALSE ⟹ advisory, unverified stays true (binding-4: no premature promotion)', () => {
    const result = projectLegitimacy({
      verdict: makeVerdict('PASS'),
      perRuleControls: new Map([['r1', control(false, true)]]),
      candidates: [makeRule('r1')],
      provenanceByRule: new Map([['r1', provenance()]]),
    });
    expect(result.stamped).toHaveLength(1);
    const stamped = result.stamped[0]!;
    expect(stamped.legitimacy!.positiveControl).toBe(false);
    expect(stamped.ruleClass).toBe('advisory');
    expect(stamped.unverified).toBe(true);
  });

  it('non-PASS verdict ⟹ stamps NOTHING (non-terminals never touch the corpus, §6 L3)', () => {
    for (const kind of ['HONEST-NEGATIVE', 'FAIL'] as const) {
      const result = projectLegitimacy({
        verdict: makeVerdict(kind),
        perRuleControls: new Map([['r1', control(true, true)]]),
        candidates: [makeRule('r1')],
        provenanceByRule: new Map([['r1', provenance()]]),
      });
      expect(result.stamped).toHaveLength(0);
      expect(result.skips).toEqual([{ reason: 'verdict-not-pass', verdict: kind }]);
    }
  });

  it('a candidate that is not a survivor (absent from perRuleControls) is skipped, not stamped', () => {
    const result = projectLegitimacy({
      verdict: makeVerdict('PASS'),
      perRuleControls: new Map(), // r1 culled / not a survivor
      candidates: [makeRule('r1')],
      provenanceByRule: new Map([['r1', provenance()]]),
    });
    expect(result.stamped).toHaveLength(0);
    expect(result.skips).toEqual([{ reason: 'not-a-survivor', ruleId: 'r1' }]);
  });

  it('a survivor missing provenance is surfaced as a skip, never fabricated', () => {
    const result = projectLegitimacy({
      verdict: makeVerdict('PASS'),
      perRuleControls: new Map([['r1', control(true, true)]]),
      candidates: [makeRule('r1')],
      provenanceByRule: new Map(), // no provenance for r1
    });
    expect(result.stamped).toHaveLength(0);
    expect(result.skips).toEqual([{ reason: 'missing-provenance', ruleId: 'r1' }]);
  });

  it('does not mutate the input candidate rule', () => {
    const candidate = makeRule('r1');
    projectLegitimacy({
      verdict: makeVerdict('PASS'),
      perRuleControls: new Map([['r1', control(true, true)]]),
      candidates: [candidate],
      provenanceByRule: new Map([['r1', provenance()]]),
    });
    expect(candidate.legitimacy).toBeUndefined();
    expect(candidate.ruleClass).toBeUndefined();
  });
});

// ─── fold-C: parse-before-write net ──────────────────

describe('buildCertifiedRulesFile (fold-C parse-before-write)', () => {
  it('round-trips a consistently-stamped projection output', () => {
    const { stamped } = projectLegitimacy({
      verdict: makeVerdict('PASS'),
      perRuleControls: new Map([['r1', control(true, true)]]),
      candidates: [makeRule('r1')],
      provenanceByRule: new Map([['r1', provenance()]]),
    });
    const file = buildCertifiedRulesFile(stamped);
    expect(file.version).toBe(1);
    expect(file.rules).toHaveLength(1);
    expect(file.rules[0]!.ruleClass).toBe('hard');
  });

  it('throws BEFORE disk on a half-stamp: legitimacy without ruleClass', () => {
    const halfStamped: CompiledRule = {
      ...makeRule('r1'),
      legitimacy: { provenance: provenance(), positiveControl: true, negativeControl: true },
      // ruleClass intentionally absent — the superRefine must reject this
    };
    expect(() => buildCertifiedRulesFile([halfStamped])).toThrow();
  });

  it('throws BEFORE disk on a half-stamp: ruleClass without legitimacy', () => {
    const halfStamped: CompiledRule = {
      ...makeRule('r1'),
      ruleClass: 'hard',
      // legitimacy intentionally absent — the superRefine must reject this
    };
    expect(() => buildCertifiedRulesFile([halfStamped])).toThrow();
  });

  it('throws BEFORE disk on an inconsistent ruleClass (hard stamp without passing controls)', () => {
    const inconsistent: CompiledRule = {
      ...makeRule('r1'),
      legitimacy: { provenance: provenance(), positiveControl: false, negativeControl: true },
      ruleClass: 'hard', // derived class is 'advisory' (positiveControl false) — inconsistent
      unverified: true,
    };
    expect(() => buildCertifiedRulesFile([inconsistent])).toThrow();
  });
});
