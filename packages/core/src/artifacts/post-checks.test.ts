/**
 * Post-check engine tests (mmnto-ai/totem#2103, strategy#474 slice 4).
 *
 * The invariants the cohort pre-build round locked in:
 *   - ADR-109: `isRejected` IFF a `decidable` rule fails; a `sensor` fail never gates.
 *   - codex must-fold: a rule that THROWS fails at its OWN declared tier — a
 *     sensor throw must not reject (no silent upgrade to decidable).
 *   - codex OQ1: caller identity prefers `runMetadata.caller`, else a `taskProfile`
 *     alias incl. the legacy `Shield → review`; unknown → undefined (abstain loudly).
 */

import { describe, expect, it } from 'vitest';

import {
  type CheckResult,
  evaluatePostChecks,
  type PostCheckContext,
  type PostCheckRule,
  resolveCaller,
} from './post-checks.js';
import type { RunArtifact } from './schema.js';

function makeArtifact(overrides: { caller?: string; taskProfile?: string } = {}): RunArtifact {
  const { caller, taskProfile = 'Spec' } = overrides;
  return {
    backend: { taskProfile },
    ...(caller !== undefined ? { admission: { runMetadata: { caller } } } : {}),
  } as unknown as RunArtifact;
}

const ctx: PostCheckContext = { configRoot: '/repo' };

function rule(
  name: string,
  tier: 'decidable' | 'sensor',
  evaluate: () => CheckResult | Promise<CheckResult>,
  appliesTo: () => boolean = () => true,
): PostCheckRule {
  return { name, tier, appliesTo, evaluate };
}

const pass: CheckResult = { verdict: 'pass', message: 'ok' };
const fail: CheckResult = { verdict: 'fail', message: 'bad' };
const abstain: CheckResult = { verdict: 'abstain', message: 'n/a' };

describe('evaluatePostChecks — ADR-109 gate isolation', () => {
  it('rejects when a decidable rule fails', async () => {
    const r = await evaluatePostChecks(makeArtifact(), [rule('d', 'decidable', () => fail)], ctx);
    expect(r.isRejected).toBe(true);
  });

  it('does NOT reject when only a sensor rule fails', async () => {
    const r = await evaluatePostChecks(makeArtifact(), [rule('s', 'sensor', () => fail)], ctx);
    expect(r.isRejected).toBe(false);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ ruleName: 's', tier: 'sensor', verdict: 'fail' });
  });

  it('a sensor rule that THROWS yields a sensor fail and does NOT reject', async () => {
    const r = await evaluatePostChecks(
      makeArtifact(),
      [
        rule('boom', 'sensor', () => {
          // totem-context: test fixture — an arbitrary Error exercises the engine's
          // non-Totem throw path; a TotemError would not test that path.
          throw new Error('kaboom');
        }),
      ],
      ctx,
    );
    expect(r.isRejected).toBe(false);
    expect(r.findings[0]).toMatchObject({ tier: 'sensor', verdict: 'fail' });
    expect(r.findings[0].message).toContain('kaboom');
  });

  it('a decidable rule that throws yields a decidable fail and rejects', async () => {
    const r = await evaluatePostChecks(
      makeArtifact(),
      [
        rule('boom', 'decidable', () => {
          // totem-context: test fixture — an arbitrary Error exercises the engine's
          // non-Totem throw path; a TotemError would not test that path.
          throw new Error('nope');
        }),
      ],
      ctx,
    );
    expect(r.isRejected).toBe(true);
    expect(r.findings[0]).toMatchObject({ tier: 'decidable', verdict: 'fail' });
  });

  it('skips rules whose appliesTo is false (no finding emitted)', async () => {
    const r = await evaluatePostChecks(
      makeArtifact(),
      [
        rule(
          'skip',
          'decidable',
          () => fail,
          () => false,
        ),
      ],
      ctx,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.isRejected).toBe(false);
  });

  it('all-abstain report does not reject', async () => {
    const r = await evaluatePostChecks(
      makeArtifact(),
      [rule('a', 'decidable', () => abstain), rule('b', 'sensor', () => abstain)],
      ctx,
    );
    expect(r.isRejected).toBe(false);
    expect(r.findings).toHaveLength(2);
  });

  it('mixed verdicts reject only on the decidable fail', async () => {
    const r = await evaluatePostChecks(
      makeArtifact(),
      [
        rule('dp', 'decidable', () => pass),
        rule('sf', 'sensor', () => fail),
        rule('df', 'decidable', () => fail),
      ],
      ctx,
    );
    expect(r.isRejected).toBe(true);
    expect(r.findings).toHaveLength(3);
  });
});

describe('resolveCaller — caller identity + taskProfile aliases', () => {
  it('prefers explicit runMetadata.caller over taskProfile', () => {
    expect(resolveCaller(makeArtifact({ caller: 'review', taskProfile: 'Spec' }))).toBe('review');
  });

  it('falls back to taskProfile alias Spec → spec', () => {
    expect(resolveCaller(makeArtifact({ taskProfile: 'Spec' }))).toBe('spec');
  });

  it('falls back to taskProfile alias Review → review', () => {
    expect(resolveCaller(makeArtifact({ taskProfile: 'Review' }))).toBe('review');
  });

  it('aliases the legacy Shield routing tag to review', () => {
    expect(resolveCaller(makeArtifact({ taskProfile: 'Shield' }))).toBe('review');
  });

  it('returns undefined for an unknown taskProfile', () => {
    expect(resolveCaller(makeArtifact({ taskProfile: 'Mystery' }))).toBeUndefined();
  });
});
