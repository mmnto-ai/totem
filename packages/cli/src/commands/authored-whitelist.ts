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
// positive fails the cert. (Corrected 2026-10-01 on the owner's measurement,
// mmnto-ai/totem#2988 S2b: a regex match on a FULL-LINE comment in a file with a
// registered grammar is telemetry-only on the normal path, in lint and in the cert;
// the hazard is live in any in-scope file with no registered grammar, on a trailing
// comment on a code line, and on fail-open parses and lint's raw fallback.) The
// registry carries this as DATA: such a class is
// listed only under `ast-grep`, so the predicate (which matches on BOTH engine and
// class) REJECTS a `regex` declaration of it — the FP-prevention is mechanical, not
// a reviewer's vigilance. Classes whose tokens never appear in prose may be regex.
// A class whose rule's scope reaches no source file (prose extensions only) has no doc-comment seam for this sentence to guard.
//
// THE PROSE SCOPE TAG (mmnto-ai/totem#2988, confirmed by letter 2026-09-30; P1 is the
// clause above, P2 is this block): the exemplar row `regex/forbidden-literal-token`
// carries `scope: 'prose'`, the only tagged row. The prose conjunct is the PREDICATE's
// — core's `evaluateStructuralEligibility` takes the record's declared `fileGlobs` for
// a tagged row, admits only when every glob is a prose glob, and records the verdict
// in its result (`scopeConjunct`) on both outcomes — so it is mechanical, not this
// table's policy and not a reviewer's: the tag makes this header's "mechanical, not a
// reviewer's vigilance" true for this row outside Gate 5 as well, where `totem rule
// author` is a product intake nothing reviews. The prose extensions are one data
// constant in core (`PROSE_EXTENSIONS`: `md`, `mdx`, `rst`, `txt`). Owner-form set id
// `static-whitelist@owner-4efdb174`: the first 8 hex of the sha256 over the compact JSON
// of `{ rows: [{ engine, structuralClass, scope }], proseExtensions: [...] }` for the
// tagged row, key order as written (`static-whitelist@owner-<sha8>`; no whitespace, no
// trailing newline, 132 bytes) — a second digest construction on purpose, because
// the `gate5-` form digests `{ engine, structuralClass }` only and cannot carry the tag
// or the constant. Pinned by authored-whitelist.test.ts; no production code computes it.

import type { WhitelistEntry } from '@mmnto/totem';

/**
 * The decidable-class data-table: the strategy-delivered cert-#1 set (the 0013Z
 * lockstep dispatch — exact-match strings coupled to lc's drafted
 * `structuralClass@engine`) plus the two original mechanism-validating exemplars
 * (retained as predicate proofs; they are decidable classes in their own right),
 * plus the Gate 5 class sets, one block per batch (batch 1: five ast-grep rows
 * delivered as data on 2026-09-24; batch 2: two ast-grep rows delivered on
 * 2026-09-27; batch 3: one ast-grep row delivered on 2026-09-29; batch 4: three
 * ast-grep rows delivered on 2026-10-04, the last batch; each row comment below
 * names its set, its dispatch and its set id).
 * The engine typing follows the 2026-06-28 ruling above: `is_finite` and
 * `procgen-entropy-clock-source` tokens can appear in prose/doc-comments ⇒
 * ast-grep only; `debug-assert-len-mismatch` matches a code-only construct ⇒
 * regex is safe. The Gate 5 batch-1 rows are ast-grep only because the scorer
 * MEASURED rule 2 (the doc-comment census over the pinned tree) and delivered no
 * regex class of that batch. From batch 2 on, rule 2 is read MODAL at the class
 * level (the operator's D7 = (a), 2026-09-27): a class whose token CAN appear in
 * prose or doc-comments is ast-grep-only, and a per-rule measured zero at one tree
 * carries no class-level guarantee — so batch 2 delivered no regex class either,
 * and batch 3 none: six of its rules are kept out on engine typing and one on
 * DECIDABILITY (rule 1), the first rule that gate keeps out. Batch 4 delivered no
 * regex class either: its five kept-out rules all fall on engine typing, two of
 * them prose-scoped pairs under rule 2's prose limb (P1 not applied in this batch).
 * The exemplar row `regex/forbidden-literal-token` is prose-only by mechanism since
 * mmnto-ai/totem#2988: its `scope: 'prose'` tag (the only tagged row) makes core's
 * predicate admit it only for a record whose every declared glob is a prose glob
 * (`PROSE_EXTENSIONS`, core: `md`, `mdx`, `rst`, `txt`), the verdict recorded in the
 * result's `scopeConjunct`; its set id is the owner form `static-whitelist@owner-4efdb174`
 * (the digest input — the tagged row and the extension constant — is in the header
 * above), pinned by authored-whitelist.test.ts.
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
  // Prose-only by mechanism (mmnto-ai/totem#2988): the tag is the predicate's scope conjunct.
  Object.freeze({ engine: 'regex', structuralClass: 'forbidden-literal-token', scope: 'prose' }),
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
  // ── The Gate 5 batch-3 class set (strategy-owned data; set `gate5-2263305c` batch 3,
  // strategy-claude's delivery dispatch of 2026-09-29T19:47:14Z under D1 (C): the scorer's
  // class-review table at strategy 2470a0ab (mmnto-ai/totem-strategy#1444) and, per that
  // dispatch, the codex D3 (i) replay converged on all ten pairs with nothing withdrawn —
  // admitted with no re-arm under the operator's D11 = (b) as recorded at that commit, its
  // rule-1 verdicts on the four absence-named pairs recorded as non-BLIND concurrences, the
  // delivered pair outside that reach). One ast-grep row. The name's breadth, disclosed with
  // the row: the fixed first argument is a string literal OR a regex literal (`fe1b4123`'s is
  // a regex literal); rules 1 and 2 hold for either kind, so no verdict depends on it. Seven
  // rules are intake-ineligible and never rows. Six on engine typing: two only under the MODAL
  // reading (`cf65e2b4`, `4ac94d6f`), two under either reading (`83b86cd7`, `5da43ea6`), and
  // two on batch 1's census, carried with no second review — this name's own REGEX pair
  // (withheld in batch 1 on `a190836d`, carried here on `434c51ff`), which stays rejected
  // because the predicate keys on the pair, and `regex/forbidden-path-literal` (carried on
  // `0615c43e`). One on DECIDABILITY (`64bb807f`, `typeof-comparison-missing-null-guard`: a
  // rule-1 FAIL on the name, the first rule that gate keeps out). In the envelope with no new
  // row: the exemplar row's four rules (`regex/forbidden-literal-token`, under the operator's
  // (A) and D9 = (a)), their admission measured at the intake pin, and `6f362fa2` under
  // batch 1's `ast-grep/type-assertion-on-call`. Set id `static-whitelist@gate5-21c0175a`: the
  // SAME rule as batches 1 and 2 — the first 8 hex of the sha256 over ONE compact JSON array
  // of THIS ONE row (`JSON.stringify` of `{ engine, structuralClass }` objects: no whitespace,
  // no trailing newline; a one-element ARRAY, 72 bytes, not the bare object) — the batch's OWN
  // slice; pinned by authored-whitelist.test.ts; the batch-3 intake pin passes it as
  // `--judged-by`. ──
  Object.freeze({ engine: 'ast-grep', structuralClass: 'forbidden-callee-literal-arg' }),
  // ── The Gate 5 batch-4 class set (strategy-owned data; set `gate5-2263305c` batch 4, the
  // last batch; strategy-claude's delivery dispatch of 2026-10-04T19:24:10Z under D1 (C): the
  // scorer's class-review table on strategy main at 3db375bb (mmnto-ai/totem-strategy#1471)
  // reviewed all ten pairs of the pin mail under the header's two rules, D7 = (a) MODAL and
  // P1 not applied in this batch; the codex D3 (i) replay converged on all ten pairs with
  // nothing withdrawn; under D12 RULED (b) the concurrence on the three delivered pairs is
  // recorded as checked, not blind). Three ast-grep rows. Each name's breadth, corrected by
  // the replayer's probes and travelling with its row: `forbidden-object-member-call` is a
  // dot-member call (`console.info('x')` matches, a computed access does not);
  // `named-callee-argument-shape` sees an object-literal second argument with a constant or
  // a variable first argument, and misses a variable options argument;
  // `try-block-expect-fail-with-catch` requires the call in the TRY block, after at least one
  // statement and directly in the block, with a catch that binds a name — the name promises
  // the shape, not a detection of tests that pass by accident. Five rules are intake-ineligible
  // on engine typing and never rows: `61dcb058` and `b34d9515` (batch 1's withheld pairs,
  // carried), `8213cd4e`, `7e3eefea` and `b3e3e2b3` (its C0–C7 and admission rows of record
  // are the replayer's, D3 (ii)). In the envelope with no new row: the exemplar row's three
  // (`884becd4`, `8435c024`, `4ae0a01d`, `regex/forbidden-literal-token` under the operator's (A),
  // R6-flagged) and the three of batch 1's `ast-grep/forbidden-callee-call` (`427481b5`,
  // `5c5fe9d9`, `63680bf3`). Set id `static-whitelist@gate5-b5bc711a`: the SAME rule as
  // batches 1 to 3 — the first 8 hex of the sha256 over ONE compact JSON array of THESE THREE
  // rows in this order (`JSON.stringify` of `{ engine, structuralClass }` objects, no
  // whitespace, no trailing newline) — the batch's OWN slice; pinned by
  // authored-whitelist.test.ts; the batch-4 intake pin passes it as `--judged-by`. ──
  Object.freeze({ engine: 'ast-grep', structuralClass: 'forbidden-object-member-call' }),
  Object.freeze({ engine: 'ast-grep', structuralClass: 'named-callee-argument-shape' }),
  Object.freeze({ engine: 'ast-grep', structuralClass: 'try-block-expect-fail-with-catch' }),
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
