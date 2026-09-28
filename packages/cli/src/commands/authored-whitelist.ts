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
// across the registry" holds. The predicate keys on the PAIR — both fields, see
// `evaluateStructuralEligibility` in core — so a class name listed under two
// engines is two distinct pairs, each with exactly one match: the predicate would
// judge BOTH decidable, never ambiguous. What refuses a class under two engines is
// this table's POLICY, not the predicate — rule 2 below keeps a prose-token class
// off regex, and authored-whitelist.test.ts pins class-name uniqueness across the
// whole table (a registry invariant whose policy basis is an open demand row of
// the batch-2 class review). (Corrected 2026-09-27 on that review's finding: this
// sentence used to call such a class "AMBIGUOUS ⇒ non-decidable", which was false
// of the shipped code.) What the predicate's exactly-one DOES read as
// non-decidable is a DUPLICATE pair, and `assertNoDuplicateEntries` fails loud at
// load before that can happen.
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
 * (retained as predicate proofs; they are decidable classes in their own right),
 * plus the Gate 5 class sets, one block per batch (batch 1: five ast-grep rows
 * delivered as data on 2026-09-24; batch 2: two ast-grep rows delivered on
 * 2026-09-27; each row comment below names its set, its dispatch and its set id).
 * The engine typing follows the 2026-06-28 ruling above: `is_finite` and
 * `procgen-entropy-clock-source` tokens can appear in prose/doc-comments ⇒
 * ast-grep only; `debug-assert-len-mismatch` matches a code-only construct ⇒
 * regex is safe. The Gate 5 batch-1 rows are ast-grep only because the scorer
 * MEASURED rule 2 (the doc-comment census over the pinned tree) and delivered no
 * regex class of that batch. From batch 2 on, rule 2 is read MODAL at the class
 * level (the operator's D7 = (a), 2026-09-27): a class whose token CAN appear in
 * prose or doc-comments is ast-grep-only, and a per-rule measured zero at one tree
 * carries no class-level guarantee — so batch 2 delivered no regex class either.
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
  // ── The Gate 5 batch-1 class set (strategy-owned data; set `gate5-2263305c` batch 1,
  // strategy-claude's delivery dispatch of 2026-09-24T00:28:55Z under D1 (C): the scorer's
  // class-review table at strategy 729fa215 and, per that dispatch, the codex D3 (i) blind
  // replay converged on every verdict with nothing withdrawn). Five ast-grep rows in the
  // delivered order. The four regex classes of that batch failed rule 2 (engine typing,
  // measured): three withheld and never rows; the fourth, `forbidden-literal-token`, is the
  // exemplar row above, its rule's admission measured at the intake pin. Set id
  // `static-whitelist@gate5-6cba5706`: the first 8 hex of the sha256 over ONE compact JSON
  // array of these five rows in this order (`JSON.stringify` of `{ engine, structuralClass }`
  // objects: no whitespace, no trailing newline; the dispatch's pretty-printed block is not
  // the input) — pinned by authored-whitelist.test.ts; the batch-1 intake pin passes it as
  // `--judged-by`. A row edit, a reorder or a re-typing is a new set id. ──
  Object.freeze({ engine: 'ast-grep', structuralClass: 'forbidden-callee-call' }),
  Object.freeze({ engine: 'ast-grep', structuralClass: 'static-import-from-module' }),
  Object.freeze({ engine: 'ast-grep', structuralClass: 'catch-without-rethrow' }),
  Object.freeze({ engine: 'ast-grep', structuralClass: 'type-assertion-on-call' }),
  Object.freeze({ engine: 'ast-grep', structuralClass: 'forbidden-constructor-throw' }),
  // ── The Gate 5 batch-2 class set (strategy-owned data; set `gate5-2263305c` batch 2,
  // strategy-claude's delivery dispatch of 2026-09-27T21:35:02Z under D1 (C): the scorer's
  // class-review table at strategy 2afa332b (mmnto-ai/totem-strategy#1438) and, per that
  // dispatch, the codex D3 (i) blind replay converged on all eleven pairs with nothing
  // withdrawn). Two ast-grep rows in the delivered order. Engine typing is MODAL from this
  // batch on (D7 = (a)): the eight rules whose regex classes fail it — seven pairs, one of
  // them batch 1's withheld `forbidden-path-literal` carried — are intake-ineligible and
  // never rows; the exemplar row's rule `5afaf8d0` (`regex/forbidden-literal-token`, the row
  // above) stays in the envelope under the operator's (A), its admission measured at the
  // intake pin; batch 1's `ast-grep/forbidden-callee-call` pair is already a row — its
  // batch-2 records (`06282905`, `240f19ca`) ride IN the envelope with no second review. Set id
  // `static-whitelist@gate5-9668b633`: the SAME rule as batch 1's — the first 8 hex of the
  // sha256 over ONE compact JSON array of THESE TWO rows in this order (`JSON.stringify` of
  // `{ engine, structuralClass }` objects: no whitespace, no trailing newline) — the batch's
  // OWN slice, never the union, because the rows ride their own patch; pinned by
  // authored-whitelist.test.ts; the batch-2 intake pin passes it as `--judged-by`. ──
  Object.freeze({ engine: 'ast-grep', structuralClass: 'forbidden-fixed-call-expression' }),
  Object.freeze({ engine: 'ast-grep', structuralClass: 'callee-call-without-argument' }),
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
 * it) — never pre-filtered, so the table the predicate judges is the table the
 * load-time duplicate guard and the class-name test read (a pre-filtered view
 * could hide a duplicate pair from the predicate's exactly-one).
 * A thin function (not a bare export) so a future data-driven source — strategy's
 * cert-#1 set loaded from a file — drops in here without touching callers.
 */
export function authoredWhitelist(): readonly WhitelistEntry[] {
  return AUTHORED_WHITELIST;
}
