import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompiledRule } from './compiler-schema.js';
import {
  applyOutcomeToRule,
  promotePendingRules,
  type PromotePendingRulesDeps,
} from './first-lint-promote.js';
import type { Stage4VerificationResult } from './stage4-verifier.js';
import { cleanTmpDir } from './test-utils.js';
import {
  readVerificationOutcomes,
  type VerificationOutcomeEntry,
  writeVerificationOutcomes,
} from './verification-outcomes.js';

// ─── Helpers ────────────────────────────────────────

function makeRule(overrides: Partial<CompiledRule> = {}): CompiledRule {
  return {
    lessonHash: 'abc123',
    lessonHeading: 'No console log',
    pattern: 'console\\.log',
    message: 'no console.log',
    engine: 'regex' as const,
    compiledAt: '2026-05-01T12:00:00.000Z',
    ...overrides,
  };
}

function makeStage4Result(
  outcome: Stage4VerificationResult['outcome'],
  overrides: Partial<Stage4VerificationResult> = {},
): Stage4VerificationResult {
  return {
    outcome,
    baselineMatches: [],
    inScopeMatches: [],
    candidateDebtLines: [],
    ...overrides,
  };
}

const FROZEN_NOW = new Date('2026-05-01T13:00:00.000Z');

// ─── applyOutcomeToRule (Invariant #3) ──────────────

describe('applyOutcomeToRule', () => {
  const baseRule = makeRule({ lessonHash: 'h1', status: 'pending-verification' });

  function entry(
    outcome: Stage4VerificationResult['outcome'],
    extras: Partial<VerificationOutcomeEntry> = {},
  ): VerificationOutcomeEntry {
    return {
      ruleHash: 'h1',
      verifiedAt: FROZEN_NOW.toISOString(),
      outcome,
      baselineMatches: [],
      inScopeMatches: [],
      candidateDebtLines: [],
      ...extras,
    };
  }

  it("maps 'no-matches' to status: 'untested-against-codebase'", () => {
    const out = applyOutcomeToRule(baseRule, entry('no-matches'));
    expect(out.status).toBe('untested-against-codebase');
  });

  it("maps 'out-of-scope' to archived with reason and timestamp", () => {
    const out = applyOutcomeToRule(baseRule, entry('out-of-scope'));
    expect(out.status).toBe('archived');
    expect(out.archivedReason).toBe('stage4-out-of-scope-match');
    expect(out.archivedAt).toBe(FROZEN_NOW.toISOString());
  });

  it('preserves prior archivedAt on out-of-scope re-archive', () => {
    const earlier = '2026-04-01T00:00:00.000Z';
    const ruleWithPrior = makeRule({ lessonHash: 'h1', archivedAt: earlier });
    const out = applyOutcomeToRule(ruleWithPrior, entry('out-of-scope'));
    expect(out.archivedAt).toBe(earlier);
  });

  it("maps 'in-scope-bad-example' to active with confidence high", () => {
    const out = applyOutcomeToRule(baseRule, entry('in-scope-bad-example'));
    expect(out.status).toBe('active');
    expect(out.confidence).toBe('high');
  });

  it("maps 'candidate-debt' to active with severity warning, overriding authored severity", () => {
    const ruleWithError = makeRule({ lessonHash: 'h1', severity: 'error' });
    const out = applyOutcomeToRule(ruleWithError, entry('candidate-debt'));
    expect(out.status).toBe('active');
    expect(out.severity).toBe('warning');
  });

  it('does not mutate the input rule object', () => {
    const original = makeRule({ lessonHash: 'h1', status: 'pending-verification' });
    applyOutcomeToRule(original, entry('no-matches'));
    expect(original.status).toBe('pending-verification');
  });
});

// ─── promotePendingRules ────────────────────────────

describe('promotePendingRules', () => {
  let tmpDir!: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-flp-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  function deps(
    overrides: Partial<PromotePendingRulesDeps> & {
      verifier: PromotePendingRulesDeps['verifier'];
    },
  ): PromotePendingRulesDeps {
    return {
      outcomesPath: path.join(tmpDir, 'verification-outcomes.json'),
      now: () => FROZEN_NOW,
      onWarn: () => {},
      ...overrides,
    };
  }

  // ── Empty-pending fast path (Invariant #9) ────

  it('returns the rules array unchanged and skips file reads when no rules are pending', async () => {
    const verifier = vi.fn();
    const onWarn = vi.fn();
    const rules: CompiledRule[] = [
      makeRule({ lessonHash: 'a', status: 'active' }),
      makeRule({ lessonHash: 'b' }),
    ];
    const result = await promotePendingRules(
      rules,
      deps({ verifier, onWarn, outcomesPath: path.join(tmpDir, 'absent.json') }),
    );
    expect(result.changed).toBe(false);
    expect(result.verifierInvocations).toBe(0);
    expect(result.promoted).toBe(0);
    expect(verifier).not.toHaveBeenCalled();
    expect(onWarn).not.toHaveBeenCalled();
    expect(result.mutatedRules).toEqual(rules);
    // No outcomes file should have been created.
    expect(fs.existsSync(path.join(tmpDir, 'absent.json'))).toBe(false);
  });

  // ── Promotion to active with candidate debt ───

  it('promotes pending rules to active with candidate debt on in-scope non-bad-example match', async () => {
    const pending = makeRule({
      lessonHash: 'p1',
      status: 'pending-verification',
      severity: 'error',
    });
    const verifier = vi.fn(async () =>
      makeStage4Result('candidate-debt', {
        inScopeMatches: ['src/foo.ts'],
        candidateDebtLines: ['src/foo.ts:10:something'],
      }),
    );
    const result = await promotePendingRules([pending], deps({ verifier }));
    expect(result.changed).toBe(true);
    expect(result.promoted).toBe(1);
    expect(result.verifierInvocations).toBe(1);
    expect(result.mutatedRules[0]?.status).toBe('active');
    expect(result.mutatedRules[0]?.severity).toBe('warning');
  });

  // ── All four outcome mappings round-trip via verifier ─

  it('maps each Stage 4 outcome to the correct terminal status (Invariant #3)', async () => {
    const rules: CompiledRule[] = [
      makeRule({ lessonHash: 'no-match-rule', status: 'pending-verification' }),
      makeRule({ lessonHash: 'oos-rule', status: 'pending-verification' }),
      makeRule({ lessonHash: 'isb-rule', status: 'pending-verification' }),
      makeRule({ lessonHash: 'cd-rule', status: 'pending-verification' }),
    ];
    const outcomesByHash: Record<string, Stage4VerificationResult['outcome']> = {
      'no-match-rule': 'no-matches',
      'oos-rule': 'out-of-scope',
      'isb-rule': 'in-scope-bad-example',
      'cd-rule': 'candidate-debt',
    };
    const verifier = vi.fn(async (rule: CompiledRule) =>
      makeStage4Result(outcomesByHash[rule.lessonHash]!),
    );
    const result = await promotePendingRules(rules, deps({ verifier }));
    expect(result.promoted).toBe(4);
    expect(result.verifierInvocations).toBe(4);
    expect(result.mutatedRules.find((r) => r.lessonHash === 'no-match-rule')?.status).toBe(
      'untested-against-codebase',
    );
    expect(result.mutatedRules.find((r) => r.lessonHash === 'oos-rule')?.status).toBe('archived');
    expect(result.mutatedRules.find((r) => r.lessonHash === 'isb-rule')?.confidence).toBe('high');
    expect(result.mutatedRules.find((r) => r.lessonHash === 'cd-rule')?.severity).toBe('warning');
  });

  // ── Memoization across runs (Invariant #4) ────

  it('skips the verifier on a second pass when an outcome is already recorded for the rule', async () => {
    const pending = makeRule({ lessonHash: 'memo', status: 'pending-verification' });
    const verifier = vi.fn(async () => makeStage4Result('in-scope-bad-example'));
    const sharedDeps = deps({ verifier });

    // First pass: writes outcomes to disk.
    await promotePendingRules([pending], sharedDeps);
    expect(verifier).toHaveBeenCalledTimes(1);

    // Second pass: rule is still pending in the manifest (caller hadn't
    // written the mutated manifest back yet, simulating the ungraceful-exit
    // recovery case). The verifier MUST NOT run again.
    verifier.mockClear();
    const second = await promotePendingRules([pending], sharedDeps);
    expect(verifier).not.toHaveBeenCalled();
    expect(second.verifierInvocations).toBe(0);
    expect(second.promoted).toBe(1);
    expect(second.mutatedRules[0]?.status).toBe('active');
    expect(second.mutatedRules[0]?.confidence).toBe('high');
  });

  // ── Hash-invalidation re-verify (Invariant #5) ─

  it('re-invokes the verifier when the rule lessonHash differs from the recorded outcome', async () => {
    const outcomesPath = path.join(tmpDir, 'verification-outcomes.json');
    // Seed the outcomes file with an entry under an OLD hash. The current
    // rule has a different lessonHash, simulating a pack content change.
    writeVerificationOutcomes(outcomesPath, {
      'old-hash': {
        ruleHash: 'old-hash',
        verifiedAt: '2026-04-01T00:00:00.000Z',
        outcome: 'in-scope-bad-example',
        baselineMatches: [],
        inScopeMatches: [],
        candidateDebtLines: [],
      },
    });
    const verifier = vi.fn(async () => makeStage4Result('no-matches'));
    const pending = makeRule({ lessonHash: 'new-hash', status: 'pending-verification' });
    const result = await promotePendingRules([pending], deps({ verifier, outcomesPath }));
    expect(verifier).toHaveBeenCalledOnce();
    expect(result.mutatedRules[0]?.status).toBe('untested-against-codebase');
  });

  // ── Verifier-throw isolation (Invariant #7) ────

  it('isolates per-rule verifier failures and leaves other rules to verify', async () => {
    const ruleA = makeRule({ lessonHash: 'fails', status: 'pending-verification' });
    const ruleB = makeRule({ lessonHash: 'passes', status: 'pending-verification' });
    const warnings: string[] = [];
    const verifier = vi.fn(async (rule: CompiledRule) => {
      if (rule.lessonHash === 'fails') throw new Error('transient fs failure');
      return makeStage4Result('in-scope-bad-example');
    });
    const result = await promotePendingRules(
      [ruleA, ruleB],
      deps({ verifier, onWarn: (m) => warnings.push(m) }),
    );
    // Both invocations are counted, including the throwing one — the metric
    // reports verifier work attempted, not work succeeded
    // (CR mmnto-ai/totem#1787 R1).
    expect(result.verifierInvocations).toBe(2);
    expect(result.verifierFailures).toBe(1);
    expect(result.promoted).toBe(1);
    expect(result.mutatedRules.find((r) => r.lessonHash === 'fails')?.status).toBe(
      'pending-verification',
    );
    expect(result.mutatedRules.find((r) => r.lessonHash === 'passes')?.status).toBe('active');
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/transient fs failure/);
  });

  // ── Outcomes file is written atomically ────────

  it('writes the outcomes file with a record per verified rule', async () => {
    const outcomesPath = path.join(tmpDir, 'verification-outcomes.json');
    const pending = makeRule({ lessonHash: 'p1', status: 'pending-verification' });
    const verifier = vi.fn(async () =>
      makeStage4Result('out-of-scope', { baselineMatches: ['tests/foo.test.ts'] }),
    );
    await promotePendingRules([pending], deps({ verifier, outcomesPath }));
    const persisted = readVerificationOutcomes(outcomesPath);
    expect(persisted['p1']?.outcome).toBe('out-of-scope');
    expect(persisted['p1']?.baselineMatches).toEqual(['tests/foo.test.ts']);
    expect(persisted['p1']?.verifiedAt).toBe(FROZEN_NOW.toISOString());
  });

  // ── No write when nothing changed ─────────────

  it('does not touch the outcomes file when only memoized hits run', async () => {
    const outcomesPath = path.join(tmpDir, 'verification-outcomes.json');
    const pending = makeRule({ lessonHash: 'memo2', status: 'pending-verification' });
    const verifier = vi.fn(async () => makeStage4Result('in-scope-bad-example'));

    await promotePendingRules([pending], deps({ verifier, outcomesPath }));
    const firstMtime = fs.statSync(outcomesPath).mtimeMs;

    // Wait at least 1ms so a re-write would surface in mtime comparison.
    await new Promise((resolve) => setTimeout(resolve, 5));
    verifier.mockClear();
    await promotePendingRules([pending], deps({ verifier, outcomesPath }));

    const secondMtime = fs.statSync(outcomesPath).mtimeMs;
    expect(secondMtime).toBe(firstMtime);
    expect(verifier).not.toHaveBeenCalled();
  });
});
