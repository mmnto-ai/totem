import { describe, expect, it } from 'vitest';

import type { CompiledRule } from './compiler-schema.js';
import * as coreIndex from './index.js';
import { effectiveSeverity, isBlockingRule, ruleTier } from './rule-tier.js';

// mmnto-ai/totem#3035 — the ONE blocking predicate, shared by `totem lint` and
// `totem rule list --blocking`. The truth table below is the full product of
// engine (ast, ast-grep, regex, absent) x ruleClass (hard, advisory, absent) x
// severity (error, warning, absent): 36 rows.

type TierInput = Pick<CompiledRule, 'engine' | 'ruleClass' | 'severity'>;

const ENGINES = ['ast', 'ast-grep', 'regex', undefined] as const;
const RULE_CLASSES = ['hard', 'advisory', undefined] as const;
const SEVERITIES = ['error', 'warning', undefined] as const;

/**
 * Build an input with ABSENT keys left off entirely (not set to undefined), the
 * shape a legacy row parsed from compiled-rules.json actually has. `engine` is
 * required by the schema, so an absent engine is a legacy-row cast.
 */
function makeInput(
  engine: (typeof ENGINES)[number],
  ruleClass: (typeof RULE_CLASSES)[number],
  severity: (typeof SEVERITIES)[number],
): TierInput {
  const input: Record<string, string> = {};
  if (engine !== undefined) input['engine'] = engine;
  if (ruleClass !== undefined) input['ruleClass'] = ruleClass;
  if (severity !== undefined) input['severity'] = severity;
  return input as unknown as TierInput;
}

/** Expected tier, written out per case rather than re-deriving the formula. */
function expectedTier(
  engine: (typeof ENGINES)[number],
  ruleClass: (typeof RULE_CLASSES)[number],
): 'hard' | 'advisory' {
  if (ruleClass === 'hard') return 'hard';
  if (ruleClass === 'advisory') return 'advisory';
  switch (engine) {
    case 'ast':
      return 'hard';
    case 'ast-grep':
      return 'hard';
    case 'regex':
      return 'advisory';
    default:
      return 'advisory';
  }
}

const TABLE = ENGINES.flatMap((engine) =>
  RULE_CLASSES.flatMap((ruleClass) =>
    SEVERITIES.map((severity) => {
      const tier = expectedTier(engine, ruleClass);
      const blocking = tier === 'hard' && severity !== 'warning';
      return {
        engine: engine ?? '(absent)',
        ruleClass: ruleClass ?? '(absent)',
        severity: severity ?? '(absent)',
        input: makeInput(engine, ruleClass, severity),
        tier,
        blocking,
      };
    }),
  ),
);

describe('rule-tier truth table (mmnto-ai/totem#3035)', () => {
  it('covers all 36 combinations', () => {
    expect(TABLE).toHaveLength(36);
  });

  it.each(TABLE)(
    'engine=$engine ruleClass=$ruleClass severity=$severity -> tier=$tier blocking=$blocking',
    ({ input, tier, blocking }) => {
      expect(ruleTier(input)).toBe(tier);
      expect(isBlockingRule(input)).toBe(blocking);
    },
  );
});

describe('rule-tier invariants (mmnto-ai/totem#3035)', () => {
  it('ruleClass wins over the engine upward: a regex row stamped hard is hard and blocks', () => {
    const rule = makeInput('regex', 'hard', 'error');
    expect(ruleTier(rule)).toBe('hard');
    expect(isBlockingRule(rule)).toBe(true);
  });

  it('ruleClass wins over the engine downward: an ast / ast-grep row stamped advisory never blocks', () => {
    for (const engine of ['ast', 'ast-grep'] as const) {
      for (const severity of SEVERITIES) {
        const rule = makeInput(engine, 'advisory', severity);
        expect(ruleTier(rule)).toBe('advisory');
        expect(isBlockingRule(rule)).toBe(false);
      }
    }
  });

  it('an absent severity blocks on a hard tier', () => {
    expect(isBlockingRule(makeInput('ast', undefined, undefined))).toBe(true);
    expect(isBlockingRule(makeInput('ast-grep', undefined, undefined))).toBe(true);
    expect(isBlockingRule(makeInput('regex', 'hard', undefined))).toBe(true);
  });

  it('a warning never blocks, whatever the tier', () => {
    for (const engine of ENGINES) {
      for (const ruleClass of RULE_CLASSES) {
        expect(isBlockingRule(makeInput(engine, ruleClass, 'warning'))).toBe(false);
      }
    }
  });

  it('a regex row (or a legacy row with no engine) never blocks unless stamped hard', () => {
    for (const engine of ['regex', undefined] as const) {
      for (const ruleClass of ['advisory', undefined] as const) {
        for (const severity of SEVERITIES) {
          expect(isBlockingRule(makeInput(engine, ruleClass, severity))).toBe(false);
        }
      }
    }
  });

  it('effectiveSeverity is the stored value, or error when absent', () => {
    expect(effectiveSeverity(makeInput('regex', undefined, 'warning'))).toBe('warning');
    expect(effectiveSeverity(makeInput('regex', undefined, 'error'))).toBe('error');
    expect(effectiveSeverity(makeInput('regex', undefined, undefined))).toBe('error');
  });

  it('is exported from the core index', () => {
    expect(coreIndex.ruleTier).toBe(ruleTier);
    expect(coreIndex.isBlockingRule).toBe(isBlockingRule);
    expect(coreIndex.effectiveSeverity).toBe(effectiveSeverity);
  });
});
