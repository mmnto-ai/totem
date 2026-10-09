/**
 * mmnto-ai/totem#3035 — the ONE blocking predicate for a compiled rule.
 *
 * `totem lint` (run-compiled-rules.ts) and `totem rule list --blocking` both
 * read this, so "the rules that block" cannot mean two different things. Pure,
 * no IO.
 *
 * Tier: `ruleClass` is the authoritative hard-tier discriminator when present
 * (spine-minted rules, mmnto-ai/totem#2183). For an un-stamped legacy rule the
 * engine is the fallback: `ast` / `ast-grep` are hard, a `regex` engine or a
 * legacy row with no engine is advisory (mmnto-ai/totem#2181).
 *
 * Blocking: hard tier AND an effective severity of `error`. A missing severity
 * is `error` — the default the linter has always acted on.
 */

import type { CompiledRule } from './compiler-schema.js';

export type RuleTier = 'hard' | 'advisory';

export type RuleTierInput = Pick<CompiledRule, 'engine' | 'ruleClass' | 'severity'>;

/** The severity the linter acts on: the stored value, or `error` when absent. */
export function effectiveSeverity(rule: Pick<CompiledRule, 'severity'>): 'error' | 'warning' {
  return rule.severity ?? 'error';
}

/** The rule's enforcement tier: its `ruleClass` stamp, else the engine fallback. */
export function ruleTier(rule: RuleTierInput): RuleTier {
  return rule.ruleClass != null
    ? rule.ruleClass
    : rule.engine === 'ast' || rule.engine === 'ast-grep'
      ? 'hard'
      : 'advisory';
}

/** Whether a violation of this rule blocks (exit 1): hard tier AND effective severity `error`. */
export function isBlockingRule(rule: RuleTierInput): boolean {
  return ruleTier(rule) === 'hard' && effectiveSeverity(rule) === 'error';
}
