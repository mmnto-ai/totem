import type { CompiledRule } from './compiler-schema.js';
import type { Stage4VerificationResult } from './stage4-verifier.js';
import {
  readVerificationOutcomes,
  type VerificationOutcomeEntry,
  type VerificationOutcomesStore,
  writeVerificationOutcomes,
} from './verification-outcomes.js';

/**
 * The first-lint promotion interceptor (mmnto-ai/totem#1684 T5).
 *
 * Pack rules installed via `totem install` enter the consumer's manifest with
 * `status: 'pending-verification'` because the cloud-compile bootstrap path
 * cannot have run Stage 4 against the consumer's codebase. On the first
 * `totem lint` run after install, this module sweeps the manifest for those
 * pending entries, invokes the Stage 4 verifier on each, and replaces the
 * status with one of the four terminal lifecycle values per Invariant #3:
 *
 *   - `'no-matches'`        → `status: 'untested-against-codebase'`
 *   - `'out-of-scope'`      → `status: 'archived'` + `archivedReason`
 *   - `'in-scope-bad-example'` → `status: 'active'` + `confidence: 'high'`
 *   - `'candidate-debt'`    → `status: 'active'` + `severity: 'warning'`
 *
 * Outcomes are written to `.totem/verification-outcomes.json` so subsequent
 * runs skip re-verification on rules whose `lessonHash` matches a recorded
 * outcome (Invariant #4). A pack content update produces a new `lessonHash`
 * which has no recorded outcome → verifier runs again (Invariant #5).
 *
 * Empty-pending fast path: when the manifest has zero `'pending-verification'`
 * rules, the function returns immediately without reading the outcomes file
 * (Invariant #9) — the common-case lint pass pays no verification cost.
 *
 * Per-rule try/catch isolates verifier-throws (Invariant #7): one rule's
 * failure does not abort the pass; that rule remains `'pending-verification'`
 * and the next lint retries.
 */

export interface PromotePendingRulesDeps {
  /**
   * Filesystem path to `.totem/verification-outcomes.json`. The interceptor
   * reads existing outcomes for memoization and atomically rewrites the
   * file when new outcomes are recorded.
   */
  readonly outcomesPath: string;
  /**
   * Pre-wired Stage 4 verifier — typically a closure that builds the
   * `Stage4VerifierDeps` once (git ls-files, baseline resolution) and then
   * invokes `verifyAgainstCodebase` per rule. Throws on transient I/O
   * errors; the interceptor catches and isolates per-rule failures.
   */
  readonly verifier: (rule: CompiledRule) => Promise<Stage4VerificationResult>;
  /**
   * ISO-now provider for `verifiedAt` timestamps. Injected so tests can
   * produce deterministic outcomes; production code passes `() => new Date()`.
   */
  readonly now?: () => Date;
  /**
   * Optional logger for verifier failures and self-healing diagnostics.
   * Defaults to a no-op when omitted — pass an explicit logger to surface
   * corrupt-cache and verifier-failure diagnostics. The CLI runner wires
   * this to `log.warn` after sanitization (see `first-lint-promote-runner.ts`).
   */
  readonly onWarn?: (msg: string) => void;
}

export interface PromotePendingRulesResult {
  /**
   * The mutated rule list. Statuses on `'pending-verification'` rules are
   * replaced per Invariant #3; rules whose verifier threw are unchanged.
   * Callers persist this to `.totem/compiled-rules.json`.
   */
  readonly mutatedRules: CompiledRule[];
  /**
   * Count of verifier calls this pass (excludes memoized hits). Includes
   * calls that threw, since the metric reports work attempted rather than
   * work succeeded — pair with `verifierFailures` to derive the success count.
   */
  readonly verifierInvocations: number;
  /** Count of rules whose status was replaced with a terminal lifecycle value. */
  readonly promoted: number;
  /** Count of rules whose verifier threw and stayed `'pending-verification'`. */
  readonly verifierFailures: number;
  /**
   * Whether any rule status mutation occurred. Callers can skip manifest
   * writes when this is `false` to avoid touching the file on no-op passes.
   */
  readonly changed: boolean;
}

const NOOP_RESULT_TEMPLATE = {
  verifierInvocations: 0,
  promoted: 0,
  verifierFailures: 0,
  changed: false,
} as const;

export async function promotePendingRules(
  rules: readonly CompiledRule[],
  deps: PromotePendingRulesDeps,
): Promise<PromotePendingRulesResult> {
  const pendingIndices: number[] = [];
  for (let i = 0; i < rules.length; i++) {
    if (rules[i]?.status === 'pending-verification') pendingIndices.push(i);
  }

  // Empty-pending fast path (Invariant #9): skip the outcomes-file read
  // when there's nothing to verify. Returns the original array unchanged
  // — callers can shallow-equal compare to detect no-op.
  if (pendingIndices.length === 0) {
    return { mutatedRules: [...rules], ...NOOP_RESULT_TEMPLATE };
  }

  const onWarn = deps.onWarn ?? (() => {});
  const now = deps.now ?? (() => new Date());

  const existingOutcomes = readVerificationOutcomes(deps.outcomesPath, onWarn);
  const updatedOutcomes: VerificationOutcomesStore = { ...existingOutcomes };

  const mutatedRules: CompiledRule[] = [...rules];
  let verifierInvocations = 0;
  let promoted = 0;
  let verifierFailures = 0;
  let outcomesChanged = false;

  for (const idx of pendingIndices) {
    const rule = mutatedRules[idx]!;
    const memoized = existingOutcomes[rule.lessonHash];

    let outcomeEntry: VerificationOutcomeEntry | null = null;

    if (memoized && memoized.ruleHash === rule.lessonHash) {
      // Memoization hit: reuse the recorded outcome. The status was either
      // never written back to the manifest (interrupted prior pass) or the
      // rule was re-stamped pending by a reinstall — either way, the
      // recorded outcome is still authoritative.
      outcomeEntry = memoized;
    } else {
      // No memoized outcome (or hash mismatch on a stale entry). Invoke the
      // verifier. Per-rule try/catch isolates failures (Invariant #7).
      try {
        verifierInvocations += 1;
        const result = await deps.verifier(rule);
        outcomeEntry = {
          ruleHash: rule.lessonHash,
          verifiedAt: now().toISOString(),
          outcome: result.outcome,
          baselineMatches: [...result.baselineMatches],
          inScopeMatches: [...result.inScopeMatches],
          candidateDebtLines: [...result.candidateDebtLines],
        };
        updatedOutcomes[rule.lessonHash] = outcomeEntry;
        outcomesChanged = true; // totem-context: per-rule verifier-throw isolation per Invariant #7 of #1684 — one failing rule must not abort the lint pass; the rule stays 'pending-verification' and next lint retries
      } catch (err) {
        verifierFailures += 1;
        onWarn(
          `Stage 4 verifier failed for rule ${rule.lessonHash} (${rule.lessonHeading}); ` +
            `leaving as 'pending-verification' for next lint retry. ` +
            `Cause: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
    }

    mutatedRules[idx] = applyOutcomeToRule(rule, outcomeEntry);
    promoted += 1;
  }

  if (outcomesChanged) {
    writeVerificationOutcomes(deps.outcomesPath, updatedOutcomes);
  }

  return {
    mutatedRules,
    verifierInvocations,
    promoted,
    verifierFailures,
    changed: promoted > 0,
  };
}

/**
 * Map a Stage 4 outcome to the rule's terminal lifecycle status per
 * Invariant #3. Pure function so the four-way mapping can be unit-tested
 * without staging the full interceptor flow. Returns a new rule object;
 * never mutates the input.
 */
export function applyOutcomeToRule(
  rule: CompiledRule,
  entry: VerificationOutcomeEntry,
): CompiledRule {
  switch (entry.outcome) {
    case 'no-matches':
      return { ...rule, status: 'untested-against-codebase' };
    case 'out-of-scope':
      return {
        ...rule,
        status: 'archived',
        archivedReason: 'stage4-out-of-scope-match',
        archivedAt: rule.archivedAt ?? entry.verifiedAt,
      };
    case 'in-scope-bad-example':
      return { ...rule, status: 'active', confidence: 'high' };
    case 'candidate-debt':
      return { ...rule, status: 'active', severity: 'warning' };
  }
}
