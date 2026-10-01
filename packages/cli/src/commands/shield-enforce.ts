/**
 * `hooks.shield.enforce` — the shield gate's own exit knob (mmnto-ai/totem#2525).
 *
 * The knob is read at RUN time by `totem review --gate` and applied to that
 * run's exit status at ONE point: around the command body, after it has either
 * returned or thrown. It never changes a line the run would otherwise print,
 * never writes a stamp and never alters a verdict. When it is set it adds one
 * line, plus — under `advisory-when-legged` only — the legs gate's own
 * corrupt-deposit sensor rows, which the derivation prints rather than drops.
 * When the value softens, a thrown failure is rendered with the CLI boundary's
 * own bytes and the run exits 0.
 *
 * Unset, a `--gate` run's output and exit are unchanged — no line, and the
 * body's outcome propagates untouched. A failure raised BEFORE the config is loaded (a flag
 * contradiction, an unloadable config) is never softened under any value — the
 * knob is unreadable there.
 *
 * Everything in this module is pure or seam-injected, so the wiring is testable
 * without the review machinery; the real seams live in `shield.ts`.
 */

import type { TotemConfig } from '@mmnto/totem';

import type { LegsGateOutcome } from './legs.js';

export type ShieldEnforce = 'block' | 'advisory' | 'advisory-when-legged';

/** What the knob needs from the legs gate's verdict for HEAD. */
export type ShieldLegsVerdict =
  | { state: 'evidence'; diffSha: string; covered?: number; owed?: number }
  | { state: 'not-owed' }
  | { state: 'unanswered' }
  | { state: 'not-derived' };

/**
 * Map the legs gate's outcome onto the verdict the knob reads. Pure, so the
 * one wiring that decides whether `advisory-when-legged` can soften is pinned
 * by a table: ONLY the structured `evidence` field yields the evidence verdict
 * — a derived `0` without it is a push that is not legs-owed.
 */
export function legsVerdictFromOutcome(
  outcome: Pick<LegsGateOutcome, 'derived' | 'evidence'>,
): ShieldLegsVerdict {
  if (outcome.evidence !== undefined) {
    return {
      state: 'evidence',
      diffSha: outcome.evidence.diffSha,
      ...(outcome.evidence.covered === undefined ? {} : { covered: outcome.evidence.covered }),
      ...(outcome.evidence.owed === undefined ? {} : { owed: outcome.evidence.owed }),
    };
  }
  // Exhaustive with no default arm: a code added to the gate's vocabulary
  // later fails the build here instead of silently adopting a verdict.
  switch (outcome.derived) {
    case 0:
      return { state: 'not-owed' };
    case 3:
      return { state: 'unanswered' };
    case 2:
      return { state: 'not-derived' };
  }
}

export interface ShieldEnforceResolution {
  /** Whether a failure of this gate run is reported and exits 0. */
  softens: boolean;
  /** The one disclosure line (no trailing newline). */
  line: string;
}

/** How many leading characters of the deposit sha the knob line names. */
const SHA_PREFIX_LENGTH = 8;

/**
 * The deposit store's own address shape (core's `DIFF_SHA_RE`): a 40-character
 * lowercase hex sha. A verdict whose sha is anything else is not a verdict the
 * knob can name honestly, so it reads as not-derived — the gate stands.
 *
 * A restatement, not a second authority: core keeps its rule private, so
 * `shield-enforce.test.ts` pins this one against `LegDepositSchema` shape by
 * shape. If the two ever part, the drift fails closed (an evidence verdict
 * reads not-derived) and that test says so first.
 */
const DEPOSIT_SHA_RE = /^[0-9a-f]{40}$/;

const KNOB_PREFIX = '[Totem] shield: hooks.shield.enforce =';

const NOT_DERIVED_LINE = `${KNOB_PREFIX} advisory-when-legged (the legs gate could not derive; run totem legs gate for the cause; the shield gate stands)`;

/**
 * The knob's decision: a function of the knob value and the legs verdict alone,
 * so a passing and a failing run of one config print the same line.
 */
export function resolveShieldEnforce(
  enforce: ShieldEnforce,
  legs: ShieldLegsVerdict | undefined,
): ShieldEnforceResolution {
  switch (enforce) {
    case 'block':
      return { softens: false, line: `${KNOB_PREFIX} block` };
    case 'advisory':
      return { softens: true, line: `${KNOB_PREFIX} advisory` };
    case 'advisory-when-legged':
      return resolveWhenLegged(legs);
    default: {
      const unreachable: never = enforce;
      return { softens: false, line: `${KNOB_PREFIX} ${String(unreachable)}` };
    }
  }
}

function resolveWhenLegged(legs: ShieldLegsVerdict | undefined): ShieldEnforceResolution {
  if (legs === undefined) return { softens: false, line: NOT_DERIVED_LINE };
  switch (legs.state) {
    case 'evidence': {
      // Asserted, not sanitized: a sha that is not the store's address shape
      // cannot be named as the deposit that answers, so the gate stands.
      if (!DEPOSIT_SHA_RE.test(legs.diffSha)) return { softens: false, line: NOT_DERIVED_LINE };
      const sha8 = legs.diffSha.slice(0, SHA_PREFIX_LENGTH);
      const covers =
        legs.covered === undefined || legs.owed === undefined
          ? ''
          : ` covers ${legs.covered}/${legs.owed}`;
      return {
        softens: true,
        line: `${KNOB_PREFIX} advisory-when-legged (legs deposit ${sha8}${covers})`,
      };
    }
    case 'not-owed':
      return {
        softens: false,
        line: `${KNOB_PREFIX} advisory-when-legged (this push is not legs-owed, so no deposit is read; the shield gate stands)`,
      };
    case 'unanswered':
      return {
        softens: false,
        line: `${KNOB_PREFIX} advisory-when-legged (legs-owed with no fresh deposit; the shield gate stands)`,
      };
    // Exhaustive with no default arm: a state added to the verdict union later
    // fails the build here instead of silently adopting a line.
    case 'not-derived':
      return { softens: false, line: NOT_DERIVED_LINE };
  }
}

/** The `onConfig` a non-gate run hands the body: the knob is never read there. */
function ignoreConfig(_ctx: ShieldKnobContext): void {
  // Deliberately inert — the knob governs `--gate` runs only.
}

/** What the command body hands the knob once its config is loaded. */
export interface ShieldKnobContext {
  enforce: ShieldEnforce | undefined;
  /** The run's working directory. */
  cwd: string;
  /** The directory the loaded config lives in. */
  configRoot: string;
  /** The loaded config, so the legs derivation reuses it rather than loading again. */
  config: TotemConfig;
}

/**
 * Run the shield command body under the knob.
 *
 * 1. Not a `--gate` run: the body runs and its outcome propagates; the knob is
 *    never read.
 * 2. A `--gate` run that fails before `onConfig`: rethrown untouched, no line.
 * 3. `onConfig` never called and the body returned: nothing is printed.
 * 4. Knob unset: the body's outcome propagates, no line.
 * 5. Knob set: the line is printed after a normal return; on a throw, a
 *    softening value renders the error and prints the line (exit 0), and any
 *    other prints the line and rethrows the ORIGINAL error.
 */
export async function runUnderShieldEnforce(params: {
  /** True only for a `--gate` run. When false the knob is never read. */
  gate: boolean;
  /** The command body. It must call `onConfig` exactly once, right after the config is loaded. */
  run: (onConfig: (ctx: ShieldKnobContext) => void) => Promise<void>;
  /** Derives the legs gate's verdict for HEAD. Called only for 'advisory-when-legged'. */
  deriveLegs: (ctx: ShieldKnobContext) => Promise<ShieldLegsVerdict>;
  renderError: (err: unknown) => void;
  /** Writes one line to stderr. */
  print: (line: string) => void;
}): Promise<void> {
  if (!params.gate) {
    await params.run(ignoreConfig);
    return;
  }

  let ctx: ShieldKnobContext | undefined;
  let failure: { err: unknown } | undefined;
  try {
    await params.run((loaded) => {
      ctx = loaded;
    });
    // totem-context: intentional — not a swallow: the failure is held only until the knob has been resolved, then either rethrown unchanged or rendered with the CLI boundary's own bytes (mmnto-ai/totem#2525)
  } catch (err) {
    failure = { err };
  }

  // Before the config loaded (or a body that never reported it): the knob is
  // unreadable, so the outcome is exactly the body's.
  if (ctx === undefined || ctx.enforce === undefined) {
    if (failure !== undefined) throw failure.err;
    return;
  }

  let legs: ShieldLegsVerdict | undefined;
  if (ctx.enforce === 'advisory-when-legged') {
    try {
      legs = await params.deriveLegs(ctx);
      // totem-context: intentional — a legs derivation that throws IS the not-derived verdict: the knob line says so and the shield's own outcome stands, so a broken derivation can never soften a failure (mmnto-ai/totem#2525)
    } catch {
      legs = { state: 'not-derived' };
    }
  }
  const resolution = resolveShieldEnforce(ctx.enforce, legs);

  if (failure === undefined) {
    params.print(resolution.line);
    return;
  }
  if (resolution.softens) {
    params.renderError(failure.err);
    params.print(resolution.line);
    return;
  }
  params.print(resolution.line);
  throw failure.err;
}
