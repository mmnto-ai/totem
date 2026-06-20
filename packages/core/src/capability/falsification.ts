// ─── #697 Layer-B — falsification harness (FM a–d) ───────────────────────────
//
// The done-criterion guard over the capability log. FM a–d (#697 fold 4):
//   (a) byte-reproducible — the ledger regenerates identically from the log;
//   (b) no-LLM-judge — STRUCTURAL via the `ResolutionSource` enum (no `llm-judge`
//       member exists), so it is unconstructible, not runtime-checked here;
//   (c) join integrity — every resolution → an existing claim; ≤1 effective terminal
//       per claim per horizon (enforced by `regenerateCapabilityLedger`'s fail-loud
//       throws, surfaced here as clause `c`);
//   (d) arithmetic integrity — every row's `decisiveN`/`hitRate` exactly equals the
//       pinned formula over its counts (catches partial-inflation / wrong-denominator).

import { canonicalStringify } from '../compile-manifest.js';
import {
  collectJoinIntegrityErrors,
  regenerateCapabilityLedger,
  type RegenerateOptions,
} from './regenerate.js';
import type { CapabilityClaim, CapabilityResolution } from './schema.js';

export type CapabilityFmClause = 'a' | 'c' | 'd';

export interface CapabilityFmViolation {
  clause: CapabilityFmClause;
  detail: string;
}

export interface CapabilityFalsificationResult {
  ok: boolean;
  violations: CapabilityFmViolation[];
}

/**
 * Run FM a/c/d over an append-only claim/resolution log. (FM-b is structural — the
 * `ResolutionSource` enum cannot express an LLM-judge — so there is nothing to check at
 * runtime; it is locked at the schema/type level + asserted in the schema tests.)
 */
export function runCapabilityFalsification(
  claims: readonly CapabilityClaim[],
  resolutions: readonly CapabilityResolution[],
  opts: RegenerateOptions,
): CapabilityFalsificationResult {
  const violations: CapabilityFmViolation[] = [];

  // FM-c: join integrity — collect the breaches (the SAME shared check `regenerate`
  // throws on) and surface each as a clause-`c` violation. No swallowing catch: the
  // regenerate call below runs only on a log already proven clean, so it cannot throw
  // here — the harness reports integrity breaches as data, never drops them (Tenet 4).
  for (const detail of collectJoinIntegrityErrors(claims, resolutions, opts)) {
    violations.push({ clause: 'c', detail });
  }
  if (violations.length > 0) return { ok: false, violations };

  const ledger = regenerateCapabilityLedger(claims, resolutions, opts);

  // FM-a: regenerating again must produce a byte-identical ledger.
  const again = regenerateCapabilityLedger(claims, resolutions, opts);
  if (canonicalStringify(ledger) !== canonicalStringify(again)) {
    violations.push({ clause: 'a', detail: 'ledger is not byte-reproducible from the log' });
  }

  // FM-d: each row's arithmetic is honest — `decisiveN` excludes partial+unresolved and
  // `hitRate` is exactly `correctN / decisiveN` (or null when no decisive evidence).
  for (const row of ledger.rows) {
    const id = `${row.agentSource}/${row.taskType}`;
    if (row.decisiveN !== row.correctN + row.wrongN) {
      violations.push({
        clause: 'd',
        detail: `row ${id}: decisiveN ${row.decisiveN} != correctN+wrongN ${row.correctN + row.wrongN}`,
      });
    }
    const expected = row.decisiveN === 0 ? null : row.correctN / row.decisiveN;
    if (row.hitRate !== expected) {
      violations.push({
        clause: 'd',
        detail: `row ${id}: hitRate ${row.hitRate} != correctN/decisiveN ${expected}`,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}
