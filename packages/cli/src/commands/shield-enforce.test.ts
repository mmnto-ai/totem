/**
 * `hooks.shield.enforce` — the knob's decision and its wrapper
 * (mmnto-ai/totem#2525). The decision table is pinned byte for byte; the
 * wrapper is driven through its injected seams, one case per branch.
 */

import { describe, expect, it, vi } from 'vitest';

import type { TotemConfig } from '@mmnto/totem';

import {
  resolveShieldEnforce,
  runUnderShieldEnforce,
  type ShieldEnforce,
  type ShieldKnobContext,
  type ShieldLegsVerdict,
} from './shield-enforce.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';

const LINE_BLOCK = '[Totem] shield: hooks.shield.enforce = block';
const LINE_ADVISORY = '[Totem] shield: hooks.shield.enforce = advisory';
const LINE_LEGGED_EVIDENCE =
  '[Totem] shield: hooks.shield.enforce = advisory-when-legged (legs deposit 01234567 covers 2/3)';
const LINE_LEGGED_NOT_OWED =
  '[Totem] shield: hooks.shield.enforce = advisory-when-legged (this push is not legs-owed, so no deposit is read; the shield gate stands)';
const LINE_LEGGED_UNANSWERED =
  '[Totem] shield: hooks.shield.enforce = advisory-when-legged (legs-owed with no fresh deposit; the shield gate stands)';
const LINE_LEGGED_NOT_DERIVED =
  '[Totem] shield: hooks.shield.enforce = advisory-when-legged (the legs gate could not derive; run totem legs gate for the cause; the shield gate stands)';

describe('resolveShieldEnforce — the decision table (mmnto-ai/totem#2525)', () => {
  const verdicts: Array<ShieldLegsVerdict | undefined> = [
    { state: 'evidence', diffSha: SHA, covered: 2, owed: 3 },
    { state: 'not-owed' },
    { state: 'unanswered' },
    { state: 'not-derived' },
    undefined,
  ];

  it('block: never softens, whatever the legs verdict', () => {
    for (const legs of verdicts) {
      expect(resolveShieldEnforce('block', legs)).toEqual({ softens: false, line: LINE_BLOCK });
    }
  });

  it('advisory: always softens, whatever the legs verdict', () => {
    for (const legs of verdicts) {
      expect(resolveShieldEnforce('advisory', legs)).toEqual({
        softens: true,
        line: LINE_ADVISORY,
      });
    }
  });

  it('advisory-when-legged + evidence: softens, naming the deposit and its coverage', () => {
    expect(
      resolveShieldEnforce('advisory-when-legged', {
        state: 'evidence',
        diffSha: SHA,
        covered: 2,
        owed: 3,
      }),
    ).toEqual({ softens: true, line: LINE_LEGGED_EVIDENCE });
  });

  it('advisory-when-legged + evidence without coverage: drops the covers clause', () => {
    expect(
      resolveShieldEnforce('advisory-when-legged', { state: 'evidence', diffSha: SHA }),
    ).toEqual({
      softens: true,
      line: '[Totem] shield: hooks.shield.enforce = advisory-when-legged (legs deposit 01234567)',
    });
  });

  it('advisory-when-legged + not-owed / unanswered / not-derived / undefined: the gate stands', () => {
    expect(resolveShieldEnforce('advisory-when-legged', { state: 'not-owed' })).toEqual({
      softens: false,
      line: LINE_LEGGED_NOT_OWED,
    });
    expect(resolveShieldEnforce('advisory-when-legged', { state: 'unanswered' })).toEqual({
      softens: false,
      line: LINE_LEGGED_UNANSWERED,
    });
    expect(resolveShieldEnforce('advisory-when-legged', { state: 'not-derived' })).toEqual({
      softens: false,
      line: LINE_LEGGED_NOT_DERIVED,
    });
    expect(resolveShieldEnforce('advisory-when-legged', undefined)).toEqual({
      softens: false,
      line: LINE_LEGGED_NOT_DERIVED,
    });
  });

  it('advisory-when-legged + an evidence sha that is not 40 lowercase hex reads as not-derived', () => {
    // A control byte — built, never authored as an escape.
    const hostile = `${SHA.slice(0, 8)}${String.fromCharCode(10)}[Totem] forged${SHA.slice(0, 20)}`;
    for (const diffSha of [hostile, SHA.toUpperCase(), SHA.slice(0, 39), `${SHA}0`, '']) {
      expect(
        resolveShieldEnforce('advisory-when-legged', {
          state: 'evidence',
          diffSha,
          covered: 1,
          owed: 1,
        }),
      ).toEqual({ softens: false, line: LINE_LEGGED_NOT_DERIVED });
    }
  });
});

// ─── The wrapper ────────────────────────────────────────────────────────────

const CONFIG = { totemDir: '.totem' } as unknown as TotemConfig;

function ctxFor(enforce: ShieldEnforce | undefined): ShieldKnobContext {
  return { enforce, cwd: '/repo', configRoot: '/repo', config: CONFIG };
}

/** The seams, recording every call in one ordered trace. */
function harness(options: {
  gate: boolean;
  /** What the body does: report a context (or not), then return or throw. */
  ctx?: ShieldKnobContext;
  throwAfterConfig?: unknown;
  throwBeforeConfig?: unknown;
  legs?: ShieldLegsVerdict | Error;
}) {
  const trace: string[] = [];
  const deriveLegs = vi.fn(async (ctx: ShieldKnobContext): Promise<ShieldLegsVerdict> => {
    trace.push(`deriveLegs ${ctx.enforce}`);
    if (options.legs instanceof Error) throw options.legs;
    return options.legs ?? { state: 'not-derived' };
  });
  const run = async (onConfig: (ctx: ShieldKnobContext) => void): Promise<void> => {
    trace.push('run');
    if (options.throwBeforeConfig !== undefined) throw options.throwBeforeConfig;
    if (options.ctx !== undefined) onConfig(options.ctx);
    if (options.throwAfterConfig !== undefined) throw options.throwAfterConfig;
  };
  const params = {
    gate: options.gate,
    run,
    deriveLegs,
    renderError: (err: unknown) => {
      trace.push(`renderError ${err instanceof Error ? err.message : String(err)}`);
    },
    print: (line: string) => {
      trace.push(`print ${line}`);
    },
  };
  return { trace, deriveLegs, invoke: () => runUnderShieldEnforce(params) };
}

describe('runUnderShieldEnforce — every branch (mmnto-ai/totem#2525)', () => {
  it('gate false: the body runs, its throw propagates, and the knob is never read', async () => {
    const failure = new Error('round failed');
    const h = harness({ gate: false, ctx: ctxFor('advisory'), throwAfterConfig: failure });
    await expect(h.invoke()).rejects.toBe(failure);
    expect(h.trace).toEqual(['run']);
    expect(h.deriveLegs).not.toHaveBeenCalled();
  });

  it('gate false: a passing body returns with nothing printed, even with the knob set', async () => {
    const h = harness({ gate: false, ctx: ctxFor('block') });
    await expect(h.invoke()).resolves.toBeUndefined();
    expect(h.trace).toEqual(['run']);
  });

  it('gate true, a throw BEFORE onConfig: rethrown untouched, no line', async () => {
    const failure = new Error('--gate and --fail-on are contradictory');
    const h = harness({ gate: true, throwBeforeConfig: failure });
    await expect(h.invoke()).rejects.toBe(failure);
    expect(h.trace).toEqual(['run']);
  });

  it('gate true, the body returns without ever calling onConfig: returns, prints nothing', async () => {
    const h = harness({ gate: true });
    await expect(h.invoke()).resolves.toBeUndefined();
    expect(h.trace).toEqual(['run']);
  });

  it('gate true, knob unset, body throws: rethrown untouched, no line (the byte-for-byte default)', async () => {
    const failure = new Error('No model specified');
    const h = harness({ gate: true, ctx: ctxFor(undefined), throwAfterConfig: failure });
    await expect(h.invoke()).rejects.toBe(failure);
    expect(h.trace).toEqual(['run']);
  });

  it('gate true, knob unset, body returns: no line', async () => {
    const h = harness({ gate: true, ctx: ctxFor(undefined) });
    await expect(h.invoke()).resolves.toBeUndefined();
    expect(h.trace).toEqual(['run']);
  });

  it('gate true, knob set, body returns: the line prints, the run passes', async () => {
    for (const [enforce, line] of [
      ['block', LINE_BLOCK],
      ['advisory', LINE_ADVISORY],
    ] as const) {
      const h = harness({ gate: true, ctx: ctxFor(enforce) });
      await expect(h.invoke()).resolves.toBeUndefined();
      expect(h.trace).toEqual(['run', `print ${line}`]);
    }
  });

  it('gate true, advisory-when-legged, body returns: the legs verdict is derived and named on a pass too', async () => {
    const h = harness({
      gate: true,
      ctx: ctxFor('advisory-when-legged'),
      legs: { state: 'unanswered' },
    });
    await expect(h.invoke()).resolves.toBeUndefined();
    expect(h.trace).toEqual([
      'run',
      'deriveLegs advisory-when-legged',
      `print ${LINE_LEGGED_UNANSWERED}`,
    ]);
  });

  it("gate true, 'advisory', body throws: the error renders, then the line, and the run resolves", async () => {
    const failure = new Error('No model specified');
    const h = harness({ gate: true, ctx: ctxFor('advisory'), throwAfterConfig: failure });
    await expect(h.invoke()).resolves.toBeUndefined();
    expect(h.trace).toEqual(['run', 'renderError No model specified', `print ${LINE_ADVISORY}`]);
    // The legs gate is consulted only for advisory-when-legged.
    expect(h.deriveLegs).not.toHaveBeenCalled();
  });

  it("gate true, 'advisory-when-legged' with evidence, body throws: softened", async () => {
    const failure = new Error('zero lanes completed');
    const h = harness({
      gate: true,
      ctx: ctxFor('advisory-when-legged'),
      throwAfterConfig: failure,
      legs: { state: 'evidence', diffSha: SHA, covered: 2, owed: 3 },
    });
    await expect(h.invoke()).resolves.toBeUndefined();
    expect(h.trace).toEqual([
      'run',
      'deriveLegs advisory-when-legged',
      'renderError zero lanes completed',
      `print ${LINE_LEGGED_EVIDENCE}`,
    ]);
  });

  it("gate true, 'block', body throws: the line prints, then the ORIGINAL error is rethrown", async () => {
    const failure = new Error('zero lanes completed');
    const h = harness({ gate: true, ctx: ctxFor('block'), throwAfterConfig: failure });
    await expect(h.invoke()).rejects.toBe(failure);
    expect(h.trace).toEqual(['run', `print ${LINE_BLOCK}`]);
  });

  it("gate true, 'advisory-when-legged' without evidence, body throws: the line prints and the error stands", async () => {
    for (const [legs, line] of [
      [{ state: 'not-owed' }, LINE_LEGGED_NOT_OWED],
      [{ state: 'unanswered' }, LINE_LEGGED_UNANSWERED],
      [{ state: 'not-derived' }, LINE_LEGGED_NOT_DERIVED],
    ] as const) {
      const failure = new Error('zero lanes completed');
      const h = harness({
        gate: true,
        ctx: ctxFor('advisory-when-legged'),
        throwAfterConfig: failure,
        legs,
      });
      await expect(h.invoke()).rejects.toBe(failure);
      expect(h.trace).toEqual(['run', 'deriveLegs advisory-when-legged', `print ${line}`]);
    }
  });

  it("gate true, 'advisory-when-legged', a THROWING legs derivation is the not-derived verdict: the error stands", async () => {
    const failure = new Error('zero lanes completed');
    const h = harness({
      gate: true,
      ctx: ctxFor('advisory-when-legged'),
      throwAfterConfig: failure,
      legs: new Error('fatal: not a git repository'),
    });
    await expect(h.invoke()).rejects.toBe(failure);
    expect(h.trace).toEqual([
      'run',
      'deriveLegs advisory-when-legged',
      `print ${LINE_LEGGED_NOT_DERIVED}`,
    ]);
  });

  it('a non-Error throw is handled the same way (rendered when softened, rethrown as-is otherwise)', async () => {
    const soft = harness({ gate: true, ctx: ctxFor('advisory'), throwAfterConfig: 'a string' });
    await expect(soft.invoke()).resolves.toBeUndefined();
    expect(soft.trace).toEqual(['run', 'renderError a string', `print ${LINE_ADVISORY}`]);
    const hard = harness({ gate: true, ctx: ctxFor('block'), throwAfterConfig: 'a string' });
    await expect(hard.invoke()).rejects.toBe('a string');
  });
});
