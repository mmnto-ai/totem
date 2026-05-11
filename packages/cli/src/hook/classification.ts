import type { HookRule } from './schema.js';

/**
 * Rule classification per ADR-104 § Convergence + § Target-aware dispatch
 * (strategy-Gemini Q1 binding synthesis, T1930Z 2026-05-11).
 *
 * Two classes:
 * - `spine`: has Rego-shadow representation; formally verified by SMT;
 *   eligible for the top ~30 invariant set. Ships in ADR-103's lint-rule
 *   pipeline. Not produced by this V1 hook engine.
 * - `interpretive`: ast-grep / regex only; no formal verification obligation;
 *   ships outside the core invariant set. All bot-pack hooks in V1 fall here.
 *
 * The hook runtime treats every rule as `interpretive`. The class is named
 * explicitly so the loader's warn-and-ignore signal on a future Spine-Rule
 * promotion attempt (`verification_shadow:` on a hook rule) carries the
 * dispatch contract in its error message rather than relying on prose docs.
 *
 * V2 may promote bot-pack hooks to `spine` via a follow-on ADR; this seam
 * is where that promotion lands.
 */
export type RuleClassification = 'spine' | 'interpretive';

export interface ClassificationResult {
  classification: RuleClassification;
  /**
   * When set, the loader SHOULD emit this string to stderr but continue
   * loading the rule. Empty when no warn-and-ignore signal applies.
   */
  warning?: string;
}

/**
 * Classify a hook rule for V1 dispatch.
 *
 * Always returns `interpretive` per ADR-104 § Target-aware dispatch (hooks
 * are Interpretive Rule class — no formal-verification obligation; PreToolUse
 * payloads are not source code, so the Rego/OPA value proposition is weaker
 * than for lint rules).
 *
 * If the rule carries a `verification_shadow:` block (forward-compat schema
 * permits this for future Spine promotion), the returned result includes a
 * structured warning. Per ADR-104 § Convergence: "the engine MUST
 * warn-and-ignore the block (the rule itself still executes as
 * Interpretive)."
 */
export function classifyHookRule(rule: HookRule): ClassificationResult {
  if (rule.verification_shadow !== undefined) {
    return {
      classification: 'interpretive',
      warning: `[totem:hook-shadow-ignored] ${rule.id}: verification_shadow block ignored in V1 (hooks are Interpretive Rule class); rule still executes`,
    };
  }
  return { classification: 'interpretive' };
}
