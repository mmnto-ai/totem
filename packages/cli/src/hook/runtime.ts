import type { CompiledHookRule } from './schema.js';

/**
 * Hook runtime evaluator (ADR-104 § Decisions 1, 2 + § Convergence).
 *
 * Takes a single hook rule plus a tool-call payload (tool name + tool args
 * as a single string) and returns a structured allow/reject decision. The
 * runtime is deterministic Node.js — no LLM calls in this path (Tenet 15
 * corollary, ADR-103 § 8).
 *
 * V1 matcher class is regex-only per execution plan § 4. ast-grep and
 * other matcher classes are deferred to V2; the schema permits future
 * `verification_shadow` blocks but the V1 runtime ignores them.
 */

export interface ToolCallPayload {
  /** The tool the agent is attempting to invoke (e.g. "bash"). */
  tool: string;
  /** Serialized tool arguments. For bash this is the command string;
   *  for structured tools, callers serialize to a stable string form. */
  args: string;
}

export type HookDecision =
  | { decision: 'allow' }
  | {
      decision: 'reject';
      message: string;
      packId: string;
      ruleId: string;
      recoveryHint?: string;
    };

/**
 * Build the structured rejection message per ADR-104 § Decision 1:
 *
 *     [totem:hook-block] <packId>/<ruleId>: <message>
 *       → <recoveryHint>
 *
 * The `→ <recoveryHint>` line is omitted when no recoveryHint is provided.
 * Agents and operators grep for the `[totem:hook-block]` prefix; the
 * `<packId>/<ruleId>` carries provenance.
 */
export function formatRejection(decision: HookDecision): string {
  if (decision.decision !== 'reject') {
    throw new Error('formatRejection: expected reject decision');
  }
  const header = `[totem:hook-block] ${decision.packId}/${decision.ruleId}: ${decision.message}`;
  if (decision.recoveryHint) {
    return `${header}\n  → ${decision.recoveryHint}`;
  }
  return header;
}

/**
 * Evaluate a single compiled hook rule against a tool-call payload.
 *
 * Two-stage gate:
 * 1. Trigger gate: does this rule apply to this tool + args?
 *    Rule applies when `rule.trigger.tool` equals `payload.tool` AND
 *    `rule.trigger.pattern` matches `payload.args`.
 * 2. Check gate: when the trigger matches, apply `rule.check.pattern` to
 *    args. `reject-if-match` rejects on match; `reject-if-no-match`
 *    rejects on non-match.
 *
 * Returns `{ decision: 'allow' }` when either gate passes the call through.
 *
 * V1 invariant: regex matching only. Future matcher classes (ast-grep,
 * Rego-shadow) ship in V2 follow-on ADRs.
 *
 * Per ADR-104 § Convergence, any `verification_shadow` block on the rule
 * is silently ignored at the runtime layer (V1 hooks are Interpretive
 * Rule class — no formal-verification obligation). Warn-and-ignore of
 * verification_shadow happens at the load layer when compiling pack
 * hooks.yaml, not on every hook-run invocation.
 */
export function evaluateHook(rule: CompiledHookRule, payload: ToolCallPayload): HookDecision {
  if (rule.trigger.tool !== payload.tool) {
    return { decision: 'allow' };
  }

  const triggerRegex = new RegExp(rule.trigger.pattern);
  if (!triggerRegex.test(payload.args)) {
    return { decision: 'allow' };
  }

  const checkRegex = new RegExp(rule.check.pattern);
  const matched = checkRegex.test(payload.args);

  const shouldReject =
    (rule.check.type === 'reject-if-match' && matched) ||
    (rule.check.type === 'reject-if-no-match' && !matched);

  if (!shouldReject) {
    return { decision: 'allow' };
  }

  return {
    decision: 'reject',
    message: rule.message,
    packId: rule.packId,
    ruleId: rule.id,
    recoveryHint: rule.recoveryHint,
  };
}
