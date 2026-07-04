// ─── ADR-112 §3 — the decidable rule-class whitelist (CLI registry, DATA) ─────
//
// The whitelist of statically-decidable `(engine, structuralClass)` pairs an
// authored rule may be admitted under. Per the strategy review bar + the cohort
// panel (gemini), this is a DATA-TABLE + a generic predicate, NOT a hardcoded
// switch: the MECHANISM (the closed predicate `evaluateStructuralEligibility`)
// lives in core; the cert-#1 CLASS SET is strategy-owned (the answer-key half on
// the strategy⇄cert critical path) and DELIVERED as data (their 2026-07-04 0013Z
// lockstep dispatch, coupled to lc's drafted rules — #2297). The two original
// shape-validating exemplars are retained as predicate proofs. The whole table is
// handed to the core predicate so "exactly one (engine, structuralClass) match
// across the registry" holds (a class present under two engines is AMBIGUOUS ⇒
// non-decidable, never structural).
//
// ENGINE-TYPING IS LOAD-BEARING (strategy ruling 2026-06-28): a forbidden-token
// class whose token can also appear in PROSE / doc-comments (e.g. `determinism`,
// `unwrap`) MUST be whitelisted for `ast-grep` (matches import/call NODES), never
// `regex` — a regex would fire on a doc-comment occurrence, and one corpus false
// positive fails the cert. The registry carries this as DATA: such a class is
// listed only under `ast-grep`, so the predicate (which matches on BOTH engine and
// class) REJECTS a `regex` declaration of it — the FP-prevention is mechanical, not
// a reviewer's vigilance. Classes whose tokens never appear in prose may be regex.

import type { WhitelistEntry } from '@mmnto/totem';

/**
 * The decidable-class data-table: the strategy-delivered cert-#1 set (the 0013Z
 * lockstep dispatch — exact-match strings coupled to lc's drafted
 * `structuralClass@engine`) plus the two original mechanism-validating exemplars
 * (retained as predicate proofs; they are decidable classes in their own right).
 * The engine typing follows the 2026-06-28 ruling above: `is_finite` and
 * `procgen-entropy-clock-source` tokens can appear in prose/doc-comments ⇒
 * ast-grep only; `debug-assert-len-mismatch` matches a code-only construct ⇒
 * regex is safe.
 */
// Each ROW is frozen too, not just the array (CR diff-review): `authoredWhitelist()` hands
// these references out, so a shallow `Object.freeze([...])` would still let another module
// rewrite `engine`/`structuralClass` after `assertNoDuplicateEntries()` has passed.
const AUTHORED_WHITELIST: readonly WhitelistEntry[] = Object.freeze([
  // ── The cert-#1 set (strategy-owned data; ADR-112 §3 / #2291) ──
  Object.freeze({ engine: 'regex', structuralClass: 'debug-assert-len-mismatch' }),
  Object.freeze({ engine: 'ast-grep', structuralClass: 'procgen-entropy-clock-source' }),
  Object.freeze({ engine: 'ast-grep', structuralClass: 'is_finite' }),
  // ── Mechanism-validating exemplars (the original predicate proofs) ──
  Object.freeze({ engine: 'regex', structuralClass: 'forbidden-literal-token' }),
  Object.freeze({ engine: 'ast-grep', structuralClass: 'node-shape-presence' }),
]);

/**
 * Registry-integrity guard (codex): a duplicate `(engine, structuralClass)` row
 * would let `evaluateStructuralEligibility`'s "exactly one match" silently read as
 * non-decidable for that pair (matches.length === 2). A duplicate is a data error,
 * not a runtime ambiguity — fail LOUD at load so it can never default to structural.
 */
function assertNoDuplicateEntries(entries: readonly WhitelistEntry[]): void {
  const seen = new Set<string>();
  for (const e of entries) {
    const key = JSON.stringify([e.engine, e.structuralClass]);
    if (seen.has(key)) {
      throw new Error(
        `[Totem Error] authored whitelist has a duplicate (engine, structuralClass): (${e.engine}, ${e.structuralClass}) — the decidable registry must be unambiguous (ADR-112 §3).`,
      );
    }
    seen.add(key);
  }
}
assertNoDuplicateEntries(AUTHORED_WHITELIST);

/**
 * The DI'd whitelist for the core eligibility predicate. Returns the FULL table
 * (the predicate does the exactly-one `(engine, structuralClass)` match across
 * it) — never pre-filtered by class, so cross-engine ambiguity stays detectable.
 * A thin function (not a bare export) so a future data-driven source — strategy's
 * cert-#1 set loaded from a file — drops in here without touching callers.
 */
export function authoredWhitelist(): readonly WhitelistEntry[] {
  return AUTHORED_WHITELIST;
}
