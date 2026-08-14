/**
 * Admission-evaluator unit tests (mmnto-ai/totem#2473).
 *
 * `evaluateAdmission` is the ONE closed evaluator behind the ruled admission
 * phase: it receives the resolved full-scope diff and returns either the exact
 * fan inputs (`admitted`) or the exact record inputs (`not-applicable` with a
 * deterministic reason). These tests lock the identity semantics — two
 * different diffs on one branch are two different observations, a policy
 * change re-keys equal bytes, and the no-diff arm carries the REQUESTED
 * selector (no global null identity) — plus the disposition→exit mapping's
 * fail-closed unknown arm under `--gate`.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { NotApplicableReason, TotemConfig } from '@mmnto/totem';
import { NOT_APPLICABLE_REASONS } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import {
  buildProjectionPolicy,
  evaluateAdmission,
  requestedSelectorForm,
  resolveNotApplicableExit,
  selectExecutionPayload,
  type ShieldOptions,
} from './shield.js';
import { CLASSIFIER_POLICY_TABLES } from './shield-classify.js';

const SHA_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const TEST_CONFIG = {
  totemDir: '.totem',
  review: { sourceExtensions: ['.ts'] },
} as unknown as TotemConfig;

/** A minimal single-file diff section for `file`. */
function diffFor(file: string): string {
  return [
    `diff --git a/${file} b/${file}`,
    'index 1111111..2222222 100644',
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ -1 +1 @@',
    '-old',
    '+new',
  ].join('\n');
}

function diffResultFor(files: string[]) {
  return {
    diff: files.map(diffFor).join('\n'),
    changedFiles: files,
    source: 'uncommitted' as const,
  };
}

describe('evaluateAdmission — the closed admission evaluator', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shield-admission-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  async function evaluate(files: string[] | null, config: TotemConfig = TEST_CONFIG) {
    return evaluateAdmission({
      diffResult: files === null ? null : diffResultFor(files),
      requestedSelector: '(default-chain)',
      cwd: tmpDir,
      config,
      quiet: true,
    });
  }

  it('no-diff (legacy scope-less arm): records source none + the REQUESTED selector', async () => {
    const outcome = await evaluate(null);
    expect(outcome.status).toBe('not-applicable');
    if (outcome.status !== 'not-applicable') return;
    expect(outcome.reason).toBe('no-diff');
    expect(outcome.scope).toEqual({
      source: 'none',
      base: null,
      head: null,
      selectorForm: '(default-chain)',
    });
    expect(outcome.inputHash).toBe(SHA_EMPTY);
    expect(outcome.skippedFileCount).toBe(0);
  });

  it('no-diff binds the RESOLVED empty scope from the discriminated resolver result (conformance note 1)', async () => {
    const resolved = await evaluateAdmission({
      diffResult: { empty: true, source: 'branch-vs-base', base: 'main' },
      requestedSelector: '(default-chain)',
      cwd: tmpDir,
      config: TEST_CONFIG,
      quiet: true,
    });
    if (resolved.status !== 'not-applicable') throw new Error('expected not-applicable');
    expect(resolved.scope).toEqual({
      source: 'branch-vs-base',
      base: 'main',
      head: null,
      selectorForm: '(default-chain)',
    });

    // The resolver's OWN selectorForm wins where it supplies one (explicit range).
    const explicit = await evaluateAdmission({
      diffResult: {
        empty: true,
        source: 'explicit-range',
        base: 'main',
        head: 'HEAD',
        selectorForm: 'main..HEAD',
      },
      requestedSelector: '--diff main..HEAD',
      cwd: tmpDir,
      config: TEST_CONFIG,
      quiet: true,
    });
    if (explicit.status !== 'not-applicable') throw new Error('expected not-applicable');
    expect(explicit.scope.selectorForm).toBe('main..HEAD');
    expect(explicit.scope.source).toBe('explicit-range');

    // Empty runs under different scopes never collapse: forced-branch,
    // explicit-range, and an empty --staged run (same terminal branch fallback,
    // different requested selector) are three distinct observations.
    const staged = await evaluateAdmission({
      diffResult: { empty: true, source: 'branch-vs-base', base: 'main' },
      requestedSelector: '--staged',
      cwd: tmpDir,
      config: TEST_CONFIG,
      quiet: true,
    });
    if (staged.status !== 'not-applicable') throw new Error('expected not-applicable');
    expect(staged.scope.selectorForm).toBe('--staged');
    const scopes = [resolved.scope, explicit.scope, staged.scope].map((s) => JSON.stringify(s));
    expect(new Set(scopes).size).toBe(3);
  });

  it('classifies each deterministic reason from the full scope', async () => {
    const nonCode = await evaluate(['docs/plan.md', 'README.md']);
    expect(nonCode.status === 'not-applicable' && nonCode.reason).toBe('all-non-code');

    const generated = await evaluate(['pnpm-lock.yaml']);
    expect(generated.status === 'not-applicable' && generated.reason).toBe('all-generated');

    // filtered-empty: a code file in the LIST whose hunks are absent from the
    // diff body (a mode-only change has this shape).
    const filteredEmpty = await evaluateAdmission({
      diffResult: {
        diff: diffFor('docs/plan.md'),
        changedFiles: ['docs/plan.md', 'src/index.ts'],
        source: 'uncommitted',
      },
      requestedSelector: '(default-chain)',
      cwd: tmpDir,
      config: TEST_CONFIG,
      quiet: true,
    });
    expect(filteredEmpty.status === 'not-applicable' && filteredEmpty.reason).toBe(
      'filtered-empty',
    );

    const admitted = await evaluate(['docs/plan.md', 'src/index.ts']);
    expect(admitted.status).toBe('admitted');
    if (admitted.status !== 'admitted') return;
    expect(admitted.filteredFiles).toEqual(['src/index.ts']);
  });

  it('two different diffs on one branch are two different observations (inputHash)', async () => {
    const a = await evaluate(['docs/a.md']);
    const b = await evaluate(['docs/b.md']);
    if (a.status !== 'not-applicable' || b.status !== 'not-applicable') {
      throw new Error('both fixtures must be not-applicable');
    }
    expect(a.reason).toBe(b.reason);
    expect(a.scope).toEqual(b.scope);
    expect(a.inputHash).not.toBe(b.inputHash);
  });

  it('a policy change re-keys equal bytes (projectionPolicyHash)', async () => {
    const a = await evaluate(['docs/a.md']);
    const b = await evaluate(['docs/a.md'], {
      ...TEST_CONFIG,
      review: { sourceExtensions: ['.ts', '.py'] },
    } as unknown as TotemConfig);
    if (a.status !== 'not-applicable' || b.status !== 'not-applicable') {
      throw new Error('both fixtures must be not-applicable');
    }
    expect(a.inputHash).toBe(b.inputHash);
    expect(a.projectionPolicyHash).not.toBe(b.projectionPolicyHash);
  });

  it('a .gitattributes change re-keys equal bytes (generated globs are policy)', async () => {
    const before = await evaluate(['docs/a.md']);
    fs.writeFileSync(path.join(tmpDir, '.gitattributes'), 'src/gen.ts linguist-generated\n');
    const after = await evaluate(['docs/a.md']);
    if (before.status !== 'not-applicable' || after.status !== 'not-applicable') {
      throw new Error('both fixtures must be not-applicable');
    }
    expect(after.projectionPolicyHash).not.toBe(before.projectionPolicyHash);
  });
});

/**
 * PINNED classifier-table digest + entry count (CR on #2641): a live-vs-live
 * recompute moves with any edit and can never observe the re-key property the
 * mechanical binding exists for. Editing ANY classifier table fails here and
 * states the new address key — update BOTH literals in the SAME commit as the
 * table edit; that update IS the re-key signal made reviewable.
 */
const EXPECTED_TABLES_DIGEST = '7641cc478a33';
const EXPECTED_TABLES_SIZE = 80;

describe('buildProjectionPolicy — classifier tables bound mechanically (leg MATERIAL 2)', () => {
  it('classifierId embeds the PINNED digest of the exported classifier tables — a table edit fails here with the new key', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shield-policy-'));
    try {
      const policy = await buildProjectionPolicy(TEST_CONFIG, tmpDir);
      // The pin makes the re-key observable; the cross-check proves the pin is
      // the digest of the LIVE constant (wiring), so the two cannot drift apart.
      expect(policy.classifierId).toBe(`classifyChangedFiles@1:${EXPECTED_TABLES_DIGEST}`);
      expect(
        createHash('sha256')
          .update(JSON.stringify(CLASSIFIER_POLICY_TABLES), 'utf-8')
          .digest('hex')
          .slice(0, 12),
      ).toBe(EXPECTED_TABLES_DIGEST);
      // Exact size — a deleted table fails here, never a range check.
      expect(CLASSIFIER_POLICY_TABLES.length).toBe(EXPECTED_TABLES_SIZE);
      expect([...CLASSIFIER_POLICY_TABLES]).toEqual([...CLASSIFIER_POLICY_TABLES].sort());
    } finally {
      cleanTmpDir(tmpDir);
    }
  });
});

describe('selectExecutionPayload — payload selection never changes admission (conformance note 3)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shield-selection-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  async function admitted() {
    const outcome = await evaluateAdmission({
      diffResult: diffResultFor(['src/full-a.ts', 'src/full-b.ts']),
      requestedSelector: '(default-chain)',
      cwd: tmpDir,
      config: TEST_CONFIG,
      quiet: true,
    });
    if (outcome.status !== 'admitted') throw new Error('fixture must admit');
    return outcome;
  }

  it('ineligible incremental → the admitted full-scope payload, un-narrowed', async () => {
    const selection = await selectExecutionPayload(
      await admitted(),
      { eligible: false, reason: 'multi-lane fan requires full diff scope' },
      tmpDir,
      true,
    );
    expect(selection.narrowed).toBe(false);
    expect(selection.deltaFallbackReason).toBeUndefined();
    expect(selection.payload.filteredFiles).toEqual(['src/full-a.ts', 'src/full-b.ts']);
  });

  it('a reviewable delta narrows the execution payload', async () => {
    const selection = await selectExecutionPayload(
      await admitted(),
      {
        eligible: true,
        deltaDiff: diffFor('src/full-a.ts'),
        changedFiles: ['src/full-a.ts'],
        linesChanged: 2,
      },
      tmpDir,
      true,
    );
    expect(selection.narrowed).toBe(true);
    expect(selection.payload.filteredFiles).toEqual(['src/full-a.ts']);
  });

  it('a non-reviewable delta falls back to the full-scope payload — never a demotion to skip', async () => {
    const selection = await selectExecutionPayload(
      await admitted(),
      {
        eligible: true,
        deltaDiff: diffFor('docs/notes.md'),
        changedFiles: ['docs/notes.md'],
        linesChanged: 2,
      },
      tmpDir,
      true,
    );
    expect(selection.narrowed).toBe(false);
    expect(selection.deltaFallbackReason).toBe('all-non-code');
    expect(selection.payload.filteredFiles).toEqual(['src/full-a.ts', 'src/full-b.ts']);
  });
});

describe('requestedSelectorForm', () => {
  const form = (options: Partial<ShieldOptions>) => requestedSelectorForm(options as ShieldOptions);

  it('records the requested selector expression per flag shape', () => {
    expect(form({ diff: 'main..HEAD' })).toBe('--diff main..HEAD');
    expect(form({ staged: true })).toBe('--staged');
    expect(form({ base: 'develop' })).toBe('--branch --base develop');
    expect(form({ branch: true })).toBe('--branch');
    expect(form({})).toBe('(default-chain)');
  });
});

describe('resolveNotApplicableExit — declared mapping, fail-closed unknown under --gate', () => {
  class FakeGateError extends Error {
    constructor(
      public code: 'SHIELD_FAILED',
      message: string,
      public hint: string,
    ) {
      super(message);
    }
  }

  it('every KNOWN reason maps to exit 0 under both bare and --gate (the ruled no-nonzero-by-default shape)', () => {
    // Iterate the core's OWN closed reason set (CR on #2641, strengthened
    // beyond the suggested typed literal — a subset would still typecheck):
    // a NEW union member is exercised automatically and would fail CLOSED
    // under --gate right here, forcing the mapping switch to grow with the
    // union in the same change.
    const known: readonly NotApplicableReason[] = NOT_APPLICABLE_REASONS;
    expect(known).toHaveLength(4);
    for (const reason of known) {
      expect(resolveNotApplicableExit(reason, false, FakeGateError)).toBe(0);
      expect(resolveNotApplicableExit(reason, true, FakeGateError)).toBe(0);
    }
  });

  it('an UNKNOWN disposition fails CLOSED under --gate and stays sensor-0 bare', () => {
    expect(() => resolveNotApplicableExit('mystery-disposition', true, FakeGateError)).toThrow(
      /unknown admission disposition/,
    );
    expect(resolveNotApplicableExit('mystery-disposition', false, FakeGateError)).toBe(0);
  });
});
