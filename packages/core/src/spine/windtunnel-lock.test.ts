import { describe, expect, it } from 'vitest';

import { firingLabelId, WindtunnelLockSchema } from './windtunnel-lock.js';

// ─── Helpers ─────────────────────────────────────────

const VALID_SHA = '0'.repeat(40);
const VALID_SHA_2 = '1'.repeat(40);
const VALID_SHA_3 = 'a'.repeat(40);

function validLock(overrides?: Record<string, unknown>) {
  return {
    schema: 'windtunnel.lock.v1',
    canonicalPath: '.totem/spine/gate-1/windtunnel.lock.json',
    gate: 'gate-1',
    phase: 'harness',
    corpus: {
      repo: 'mmnto-ai/liquid-city',
      selectionRule: {
        state: 'merged',
        predicate: 'touches-code',
        window: { type: 'all' },
        asOfCommit: VALID_SHA,
      },
      resolvedPrs: [
        {
          pr: 1,
          mergeCommit: VALID_SHA,
          baseSha: VALID_SHA_2,
          headSha: VALID_SHA_3,
        },
        {
          pr: 2,
          mergeCommit: VALID_SHA_2,
          baseSha: VALID_SHA_3,
          headSha: VALID_SHA,
        },
      ],
    },
    fpDefinition: {
      rubricRef: 'controls/rubric.md',
      groundTruthRef: 'controls/ground-truth-labels.json',
      adjudicator: 'operator',
      precisionFloor: 1.0,
    },
    controls: {
      positiveRef: 'controls/positive/',
      negativeRef: 'controls/negative/',
      integrity: {
        mechanism: 'git-hash-object',
        fixtureSha: VALID_SHA,
      },
    },
    cullRateThreshold: 0.25,
    exposureDenominator: {
      activeRulesEvaluated: { floor: 2 },
      filesTouchedInWindow: { floor: 0 },
      positiveControlsExercised: { floor: 0 },
    },
    ...overrides,
  };
}

// ─── Schema acceptance ───────────────────────────────

describe('WindtunnelLockSchema acceptance', () => {
  it('accepts a valid harness-phase lock', () => {
    const result = WindtunnelLockSchema.safeParse(validLock());
    expect(result.success).toBe(true);
  });

  it('accepts a certifying-phase lock', () => {
    const result = WindtunnelLockSchema.safeParse(validLock({ phase: 'certifying' }));
    expect(result.success).toBe(true);
  });

  it('accepts a bounded window lock', () => {
    const lock = validLock();
    (lock.corpus.selectionRule as Record<string, unknown>).window = { type: 'bounded', n: 50 };
    const result = WindtunnelLockSchema.safeParse(lock);
    expect(result.success).toBe(true);
  });
});

// ─── Schema rejection invariants ─────────────────────

describe('WindtunnelLockSchema rejection', () => {
  it('rejects precisionFloor !== 1.0', () => {
    const lock = validLock();
    (lock.fpDefinition as Record<string, unknown>).precisionFloor = 0.9;
    const result = WindtunnelLockSchema.safeParse(lock);
    expect(result.success).toBe(false);
  });

  it('rejects non-40-hex asOfCommit', () => {
    const lock = validLock();
    (lock.corpus.selectionRule as Record<string, unknown>).asOfCommit = 'notahex';
    const result = WindtunnelLockSchema.safeParse(lock);
    expect(result.success).toBe(false);
  });

  it('rejects empty resolvedPrs', () => {
    const lock = validLock();
    (lock.corpus as Record<string, unknown>).resolvedPrs = [];
    const result = WindtunnelLockSchema.safeParse(lock);
    expect(result.success).toBe(false);
  });

  it('rejects resolvedPrs entries missing mergeCommit (C4)', () => {
    const lock = validLock();
    (lock.corpus as Record<string, unknown>).resolvedPrs = [
      { pr: 1, baseSha: VALID_SHA, headSha: VALID_SHA_2 },
    ];
    const result = WindtunnelLockSchema.safeParse(lock);
    expect(result.success).toBe(false);
  });

  it('rejects resolvedPrs entries missing baseSha (C4)', () => {
    const lock = validLock();
    (lock.corpus as Record<string, unknown>).resolvedPrs = [
      { pr: 1, mergeCommit: VALID_SHA, headSha: VALID_SHA_2 },
    ];
    const result = WindtunnelLockSchema.safeParse(lock);
    expect(result.success).toBe(false);
  });

  it('rejects resolvedPrs entries missing headSha (C4)', () => {
    const lock = validLock();
    (lock.corpus as Record<string, unknown>).resolvedPrs = [
      { pr: 1, mergeCommit: VALID_SHA, baseSha: VALID_SHA_2 },
    ];
    const result = WindtunnelLockSchema.safeParse(lock);
    expect(result.success).toBe(false);
  });

  it('rejects duplicate pr numbers in resolvedPrs (C4)', () => {
    const lock = validLock();
    (lock.corpus as Record<string, unknown>).resolvedPrs = [
      { pr: 1, mergeCommit: VALID_SHA, baseSha: VALID_SHA_2, headSha: VALID_SHA_3 },
      { pr: 1, mergeCommit: VALID_SHA_2, baseSha: VALID_SHA_3, headSha: VALID_SHA },
    ];
    const result = WindtunnelLockSchema.safeParse(lock);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('unique');
  });

  it('rejects unsorted pr numbers in resolvedPrs (C4)', () => {
    const lock = validLock();
    (lock.corpus as Record<string, unknown>).resolvedPrs = [
      { pr: 2, mergeCommit: VALID_SHA, baseSha: VALID_SHA_2, headSha: VALID_SHA_3 },
      { pr: 1, mergeCommit: VALID_SHA_2, baseSha: VALID_SHA_3, headSha: VALID_SHA },
    ];
    const result = WindtunnelLockSchema.safeParse(lock);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('sorted');
  });

  it('rejects absent cullRateThreshold (C5)', () => {
    const lock = validLock();
    delete (lock as Record<string, unknown>)['cullRateThreshold'];
    const result = WindtunnelLockSchema.safeParse(lock);
    expect(result.success).toBe(false);
  });

  it('rejects cullRateThreshold >= 1 (C5)', () => {
    const lock = validLock({ cullRateThreshold: 1.0 });
    const result = WindtunnelLockSchema.safeParse(lock);
    expect(result.success).toBe(false);
  });

  it('rejects negative cullRateThreshold (C5)', () => {
    const lock = validLock({ cullRateThreshold: -0.1 });
    const result = WindtunnelLockSchema.safeParse(lock);
    expect(result.success).toBe(false);
  });

  it('accepts cullRateThreshold = 0 (boundary)', () => {
    const lock = validLock({ cullRateThreshold: 0 });
    const result = WindtunnelLockSchema.safeParse(lock);
    expect(result.success).toBe(true);
  });

  it('rejects activeRulesEvaluated.floor < 2', () => {
    const lock = validLock();
    lock.exposureDenominator.activeRulesEvaluated.floor = 1;
    const result = WindtunnelLockSchema.safeParse(lock);
    expect(result.success).toBe(false);
  });

  it('accepts activeRulesEvaluated.floor = 2 (boundary)', () => {
    const lock = validLock();
    lock.exposureDenominator.activeRulesEvaluated.floor = 2;
    const result = WindtunnelLockSchema.safeParse(lock);
    expect(result.success).toBe(true);
  });

  it('rejects unknown phase', () => {
    const lock = validLock({ phase: 'unknown' });
    const result = WindtunnelLockSchema.safeParse(lock);
    expect(result.success).toBe(false);
  });

  it('rejects non-40-hex mergeCommit', () => {
    const lock = validLock();
    (lock.corpus as Record<string, unknown>).resolvedPrs = [
      { pr: 1, mergeCommit: 'short', baseSha: VALID_SHA, headSha: VALID_SHA_2 },
    ];
    const result = WindtunnelLockSchema.safeParse(lock);
    expect(result.success).toBe(false);
  });
});

// ─── firingLabelId ───────────────────────────────────

describe('firingLabelId (A2)', () => {
  it('returns a 64-char hex SHA-256', () => {
    const id = firingLabelId('rule-abc', 42, 'src/foo.ts', 'const secret = "abc"');
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same inputs', () => {
    const a = firingLabelId('rule-abc', 42, 'src/foo.ts', 'const secret = "abc"');
    const b = firingLabelId('rule-abc', 42, 'src/foo.ts', 'const secret = "abc"');
    expect(a).toBe(b);
  });

  it('differs when ruleId differs', () => {
    const a = firingLabelId('rule-abc', 42, 'src/foo.ts', 'line');
    const b = firingLabelId('rule-def', 42, 'src/foo.ts', 'line');
    expect(a).not.toBe(b);
  });

  it('differs when pr differs', () => {
    const a = firingLabelId('rule-abc', 1, 'src/foo.ts', 'line');
    const b = firingLabelId('rule-abc', 2, 'src/foo.ts', 'line');
    expect(a).not.toBe(b);
  });

  it('normalizes Windows backslash paths (A3)', () => {
    const forward = firingLabelId('rule', 1, 'src/foo.ts', 'line');
    const backward = firingLabelId('rule', 1, 'src\\foo.ts', 'line');
    expect(forward).toBe(backward);
  });
});
