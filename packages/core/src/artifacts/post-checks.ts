/**
 * Deterministic structural post-checks (mmnto-ai/totem#2103, strategy#474 slice 4).
 *
 * Zero-LLM, caller-side checks over a finished run artifact. Each check is a
 * {@link PostCheckRule} that returns a verdict at a STATIC enforcement tier:
 *   - `decidable` — a structural fact that can be mechanically resolved (a cited
 *     file exists, a line is in range, output parses against a schema). These
 *     MAY gate: a decidable `fail` rejects the run.
 *   - `sensor` — a softer signal (claim support, summary faithfulness). These
 *     NEVER gate; they are telemetry only.
 *
 * The load-bearing invariant (ADR-109 — blurring decidable gates with soft
 * sensors trains users to bypass the gate): `isRejected` is true IFF some
 * `decidable` rule returned `fail`. A `sensor` finding can never set it — and
 * critically (mmnto-ai/totem#2103 codex review), a rule that THROWS is a fail at
 * the rule's OWN declared tier, never silently upgraded to decidable. A sensor
 * rule that throws must not reject the run.
 *
 * Verdict aggregation is a pure script, never an LLM (Tenet 9). This module is
 * in-memory only (no persisted shape) → plain TS interfaces, not Zod.
 */

import { getErrorMessage } from '../errors.js';
import type { RunArtifact } from './schema.js';

/** Whether a rule's verdict may gate (`decidable`) or is telemetry only (`sensor`). */
export type EnforcementTier = 'decidable' | 'sensor';

/** A single rule's outcome. `abstain` = the rule did not apply to this artifact's content (honest-absent), distinct from `pass`. */
export type CheckVerdict = 'pass' | 'fail' | 'abstain';

/**
 * What a rule's `evaluate` returns: the verdict plus a human-facing reason
 * (every finding explains itself — Tenet 4, no silent degradation) and optional
 * structured context for the eval harness.
 */
export interface CheckResult {
  verdict: CheckVerdict;
  message: string;
  context?: Record<string, unknown>;
}

/** A finding as recorded in the report: a {@link CheckResult} stamped with the rule's identity + static tier. */
export interface PostCheckFinding extends CheckResult {
  ruleName: string;
  tier: EnforcementTier;
}

/** The aggregate report. `isRejected` is owned solely by {@link evaluatePostChecks}. */
export interface PostCheckReport {
  findings: PostCheckFinding[];
  /** True IFF a `decidable` finding has verdict `fail`. Nothing else may set it. */
  isRejected: boolean;
}

/**
 * The minimum override-memory interface a review rule consumes (mmnto-ai/totem#2103
 * OQ2 — this slice owns the CHECK, mmnto-ai/totem#2105 owns the STORE). #2103 defines
 * only this read shape; no persisted schema, no file reader, no durable identity
 * format beyond what the injected set supplies. Absent ⇒ the override rule abstains.
 */
export interface OverrideSet {
  /**
   * Identities of recorded (still-rejected) overrides whose anchored span
   * reappears verbatim in `outputContent`. Empty ⇒ none reappeared. The
   * anchored-span KEY FORMAT lives entirely in the store (mmnto-ai/totem#2105);
   * #2103 only asks "did any reappear" and never constructs a key (OQ2 boundary).
   */
  reappearsIn(outputContent: string): readonly string[];
}

/** Per-invocation context. `configRoot` anchors citation `filePath` resolution (schema: absent `sourceRepo` ⇒ run's own repo). */
export interface PostCheckContext {
  configRoot: string;
  /** Test seam — override the file read. Production callers omit it (defaults to a real fs read). */
  readFile?: (absPath: string) => string | undefined;
  /** Injected by the caller; empty/absent until mmnto-ai/totem#2105 supplies a store. */
  overrideMemory?: OverrideSet;
}

/** A structural post-check. `tier` is STATIC (never derived from a verdict). `appliesTo` sees the whole artifact so it can key on caller AND admission class. */
export interface PostCheckRule {
  name: string;
  tier: EnforcementTier;
  /**
   * Whether this rule applies to the artifact. MUST be a pure, non-throwing
   * predicate — the engine wraps only `evaluate` (a rule throw → a tier-preserving
   * fail), so a throwing `appliesTo` would escape as an unhandled engine fault
   * (CR review). All built-in predicates are trivially safe; third-party rules
   * must honor this.
   */
  appliesTo(artifact: RunArtifact): boolean;
  evaluate(artifact: RunArtifact, ctx: PostCheckContext): CheckResult | Promise<CheckResult>;
}

/**
 * Caller-identity aliases (mmnto-ai/totem#2103 codex review). Old review artifacts
 * carry `backend.taskProfile: 'Shield'` (the routing `TAG`), not `'Review'` (the
 * `DISPLAY_TAG`) — see `packages/cli/src/commands/shield-templates.ts`. A fallback
 * that accepted only `Spec`/`Review` would silently skip review rules on existing
 * review fixtures.
 */
const TASK_PROFILE_ALIASES: Readonly<Record<string, string>> = {
  Spec: 'spec',
  Review: 'review',
  Shield: 'review',
};

/**
 * The run's caller identity (`spec` / `review` / …) for caller-scoped rule
 * targeting. Prefers the explicit `runMetadata.caller` (mmnto-ai/totem#2102), falling
 * back to a `taskProfile` alias for slice-1/2 artifacts that predate it. An
 * UNKNOWN profile returns `undefined` — caller-scoped rules then abstain loudly,
 * never guess.
 */
export function resolveCaller(artifact: RunArtifact): string | undefined {
  const caller = artifact.admission?.runMetadata?.caller;
  // Lower-case the explicit caller too (CR review): an artifact carrying
  // `caller: 'Spec'` would otherwise be returned verbatim and silently skip every
  // caller-scoped gate (which compare against lower-case `'spec'`/`'review'`).
  if (caller !== undefined) return caller.toLowerCase();
  return TASK_PROFILE_ALIASES[artifact.backend.taskProfile];
}

/**
 * Run every applicable rule and aggregate. Pure, deterministic, zero-LLM.
 *
 * A rule that THROWS yields a `fail` at the rule's OWN declared tier (a sensor
 * throw is a sensor fail — it must not reject; mmnto-ai/totem#2103 codex review).
 * Only a genuine engine bug (not a rule fault) escapes this loop as an
 * exception — engine-integrity faults are never laundered into a finding.
 */
export async function evaluatePostChecks(
  artifact: RunArtifact,
  rules: readonly PostCheckRule[],
  ctx: PostCheckContext,
): Promise<PostCheckReport> {
  const findings: PostCheckFinding[] = [];
  for (const rule of rules) {
    if (!rule.appliesTo(artifact)) continue;
    let result: CheckResult;
    // totem-context: fail-loud, not swallow — a rule's own throw is converted into a
    // 'fail' finding at the rule's declared tier (OQ4) and surfaced in the report. Only
    // rule.evaluate is wrapped, so a genuine engine-integrity fault still bubbles out.
    try {
      result = await rule.evaluate(artifact, ctx);
    } catch (err) {
      result = {
        verdict: 'fail',
        message: `rule "${rule.name}" threw: ${getErrorMessage(err)}`,
      };
    }
    findings.push({ ruleName: rule.name, tier: rule.tier, ...result });
  }
  const isRejected = findings.some((f) => f.tier === 'decidable' && f.verdict === 'fail');
  return { findings, isRejected };
}
