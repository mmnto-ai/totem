// ─── The differential comparator ─────────────────────────────────────────────
//
// Binding: `rego/LOWERING.md` § Comparator —
//   "Per (record, fixture): shipped VerdictRow (from `artifacts/shipped-verdicts.json`)
//    vs OPA-arm row vs regorus row. PASS per the ruled criteria = identical
//    violation multisets AND event streams on every fixture; any divergence is
//    classified explained/unexplained; unexplained ⇒ spike FAIL/park."
//
// and spec § Differential units, which fixes what a verdict IS:
//   - a VERDICT is the violation MULTISET for a (rule, fixture) pair;
//   - `matchCount` is the SHIPPED violation count, engine-asymmetric;
//   - `fired` derives from violations, never from trigger events.
//
// The comparison key is `(rule_id, line_number, ordinal)`. Only the Rego arms
// carry an ordinal natively, so the shipped side's is DERIVED — see
// `deriveShippedOrdinals`, which pairs each shipped violation against the
// FactBundle's `astMatches` rather than assuming array order. A derivation that
// cannot be made is a reported divergence, never a silent zero.
//
// Exit code is the verdict: 0 iff there are ZERO unexplained divergences.
//
// Run: node --experimental-strip-types src/compare.mts

import * as fs from 'node:fs';
import * as path from 'node:path';

import { activeRecordSet } from './lib/record-sets.mts';
import { ARTIFACTS_DIR, Checks, FACTS_DIR, writeArtifact } from './lib/spike-env.mts';

// ─── Types ───────────────────────────────────────────────────────────────────

type Arm = 'shipped' | 'opa' | 'regorus';

interface RegoViolation {
  rule_id: string;
  line_number: number;
  ordinal: number;
}
interface RegoEvent {
  kind: string;
  line_number: number;
  ordinal: number;
}

interface NormalRow {
  arm: Arm;
  ruleId: string;
  fixtureId: string;
  specimen: string;
  /** G4 — the seed entry beside the specimen, so a rule's N records group. */
  seedEntry: string | null;
  engine: string;
  /** null when the arm produced an ERROR ROW rather than a verdict. */
  violations: RegoViolation[] | null;
  events: { kind: string; line: number }[] | null;
  fired: boolean | null;
  matchCount: number | null;
  error: string | null;
  /** Set on the shipped arm: how each ordinal was obtained. */
  ordinalDerivation?: string;
}

function readArtifact(name: string): any {
  const at = path.join(ARTIFACTS_DIR, name);
  if (!fs.existsSync(at)) {
    throw new Error(
      `${at} is missing. Run, in order: src/lower.mts, src/build-wasm.mts, ` +
        `\`cargo run --release -- --arm opa\` and \`--arm regorus\` in host/, then this.`,
    );
  }
  return JSON.parse(fs.readFileSync(at, 'utf-8'));
}

// ─── Normalisation ───────────────────────────────────────────────────────────

/**
 * The shipped arm's ordinals, DERIVED — the shipped `Violation` has no ordinal
 * field, so one has to be reconstructed to compare on the contract's key.
 *
 * § Lowering 1 fixes the meaning per engine:
 *   regex    "always 0, shipped emits ≤1 per line"    → 0, and >1 per line is a defect
 *   ast-grep "the match index"                        → the index into `astMatches`
 *
 * For ast-grep the pairing is done AGAINST THE FACT BUNDLE, greedily by line
 * number, rather than by trusting the artifact's array order. Array order would
 * be the tempting shortcut and it is wrong in general: `shipped-verdicts.json`
 * stores violations SORTED by `(ruleId, lineNumber)`, whereas the ordinal is
 * defined by the dispatcher's MATCH order — the two coincide here only because
 * the sort is stable and `astMatches` ascends. An unpairable violation is
 * reported, never defaulted to 0.
 */
function deriveShippedOrdinals(
  engine: string,
  ruleId: string,
  violations: { ruleId: string; lineNumber: number }[],
  astMatches: { lineNumber: number }[],
): { violations: RegoViolation[]; derivation: string; problems: string[] } {
  const problems: string[] = [];

  if (engine === 'regex') {
    const perLine = new Map<number, number>();
    for (const v of violations) perLine.set(v.lineNumber, (perLine.get(v.lineNumber) ?? 0) + 1);
    for (const [line, n] of perLine) {
      if (n > 1) {
        problems.push(
          `regex row emitted ${n} violations on line ${line}; § Lowering 1 says the shipped regex path emits at most one per line, so the ordinal is undefined here`,
        );
      }
    }
    return {
      violations: violations.map((v) => ({
        rule_id: v.ruleId,
        line_number: v.lineNumber,
        ordinal: 0,
      })),
      derivation:
        'regex: ordinal := 0 (§ Lowering 1 — the shipped regex path emits ≤1 violation per added line)',
      problems,
    };
  }

  const used = new Set<number>();
  const out: RegoViolation[] = [];
  for (const v of violations) {
    const idx = astMatches.findIndex((m, i) => !used.has(i) && m.lineNumber === v.lineNumber);
    if (idx < 0) {
      problems.push(
        `shipped violation at line ${v.lineNumber} pairs with no unused astMatch (bundle has ${astMatches.length} matches at lines [${astMatches.map((m) => m.lineNumber).join(', ')}])`,
      );
      continue;
    }
    used.add(idx);
    out.push({ rule_id: v.ruleId, line_number: v.lineNumber, ordinal: idx });
  }
  return {
    violations: out,
    derivation:
      'ast-grep: ordinal := the index of the FactBundle `astMatches` entry this violation pairs with, matched greedily by lineNumber (§ Lowering 1 — "the match index")',
    problems,
  };
}

function normaliseShipped(
  rows: any[],
  bundles: Map<string, any>,
  seedEntryByFixture: Map<string, string | null>,
): NormalRow[] {
  return rows.map((r) => {
    const bundle = bundles.get(r.fixtureId);
    if (!bundle) throw new Error(`shipped row ${r.fixtureId} has no FactBundle`);
    // (G8/K5b) The shipped arm's own ERROR ROW. It carries no arms by construction —
    // there is no verdict over a malformed FactBundle — so the `armsAgree` and
    // ordinal-derivation machinery below has nothing to read. Surfaced as an error
    // row, exactly like the wasmtime/regorus/wazero arms do for the same bundle.
    if (typeof r.error === 'string') {
      return {
        arm: 'shipped' as const,
        ruleId: r.ruleId,
        fixtureId: r.fixtureId,
        specimen: r.specimen,
        seedEntry: r.seedEntry ?? seedEntryByFixture.get(r.fixtureId) ?? null,
        engine: r.engine,
        violations: null,
        events: null,
        fired: null,
        matchCount: null,
        error: r.error,
      };
    }
    // Reducing a two-arm shipped row to `arms[0]` is only sound while the
    // artifact records that the arms AGREE. For regex specimens the two arms are
    // different dispatchers — `applyRulesToAdditions` (arm1-pin) and
    // `applyRulesToAdditionsBounded` (arm2-lint, what `totem lint` runs, and the
    // one carrying the timeout path). If arm2 ever diverged, silently comparing
    // arm1 against OPA would report MATCH and exit 0, laundering a real
    // shipped-side divergence into a PASS. The exit code IS the verdict here, so
    // this fails loud, the same way an unpairable ordinal already aborts the run.
    if (r.armsAgree !== true) {
      throw new Error(
        `shipped row ${r.fixtureId} reports armsAgree=${JSON.stringify(r.armsAgree)}; ` +
          `arms[0] is not a sound stand-in for the shipped verdict`,
      );
    }
    const primary = r.arms[0];
    if (!primary) throw new Error(`shipped row ${r.fixtureId} carries no arms`);
    const d = deriveShippedOrdinals(
      r.engine,
      r.ruleId,
      primary.violations,
      bundle.astMatches ?? [],
    );
    if (d.problems.length > 0) {
      throw new Error(`ordinal derivation failed for ${r.fixtureId}: ${d.problems.join('; ')}`);
    }
    return {
      arm: 'shipped' as const,
      ruleId: r.ruleId,
      fixtureId: r.fixtureId,
      specimen: r.specimen,
      seedEntry: r.seedEntry ?? seedEntryByFixture.get(r.fixtureId) ?? null,
      engine: r.engine,
      violations: d.violations,
      // The shipped event context's `line` is the line NUMBER; the Violation's
      // `line` is the matched TEXT. Projecting on the wrong one would compare
      // source text against integers and always diverge.
      events: (r.events as any[]).map((e) => ({ kind: e.kind, line: e.line })),
      fired: r.fired,
      matchCount: r.matchCount,
      error: null,
      ordinalDerivation: d.derivation,
    };
  });
}

/**
 * The host arms' rows.
 *
 * `seedEntry` is joined in from the fact index rather than read off the row: the
 * Rust host and the Go probe emit the wasmtime row shape unchanged, so the label is
 * attached HERE, where the join key already is, instead of by editing a host that
 * needs no other change for the seed set.
 */
function normaliseRego(
  arm: 'opa' | 'regorus',
  rows: any[],
  seedEntryByFixture: Map<string, string | null>,
): NormalRow[] {
  return rows.map((r) => ({
    arm,
    ruleId: r.ruleId,
    fixtureId: r.fixtureId,
    specimen: r.specimen,
    seedEntry: r.seedEntry ?? seedEntryByFixture.get(r.fixtureId) ?? null,
    engine: r.engine,
    violations: r.error === null ? (r.violations as RegoViolation[]) : null,
    events:
      r.error === null
        ? (r.events as RegoEvent[]).map((e) => ({ kind: e.kind, line: e.line_number }))
        : null,
    fired: r.fired,
    matchCount: r.matchCount,
    error: r.error ?? null,
  }));
}

// ─── Multiset comparison ─────────────────────────────────────────────────────

function counts(keys: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

function multisetEqual(a: string[], b: string[]): boolean {
  const ca = counts(a);
  const cb = counts(b);
  if (ca.size !== cb.size) return false;
  for (const [k, n] of ca) if (cb.get(k) !== n) return false;
  return true;
}

/** `(rule_id, line_number, ordinal)` — the contract's key. */
const strictKeys = (v: RegoViolation[]): string[] =>
  v.map((x) => `${x.rule_id}|${x.line_number}|${x.ordinal}`).sort();
/** `(rule_id, line_number)` — the weaker key, used ONLY to name an ordinal-only divergence. */
const lineKeys = (v: RegoViolation[]): string[] =>
  v.map((x) => `${x.rule_id}|${x.line_number}`).sort();
const eventKeys = (e: { kind: string; line: number }[]): string[] =>
  e.map((x) => `${x.kind}|${x.line}`).sort();

function multisetDiff(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } {
  const ca = counts(a);
  const cb = counts(b);
  const onlyA: string[] = [];
  const onlyB: string[] = [];
  for (const [k, n] of ca) {
    const d = n - (cb.get(k) ?? 0);
    for (let i = 0; i < d; i++) onlyA.push(k);
  }
  for (const [k, n] of cb) {
    const d = n - (ca.get(k) ?? 0);
    for (let i = 0; i < d; i++) onlyB.push(k);
  }
  return { onlyA: onlyA.sort(), onlyB: onlyB.sort() };
}

type Status = 'MATCH' | 'EXPLAINED-DIVERGENCE' | 'UNEXPLAINED-DIVERGENCE';

interface PairResult {
  ruleId: string;
  fixtureId: string;
  specimen: string;
  /** G4 — the seed entry beside the specimen, so a rule's N pairs group. */
  seedEntry: string | null;
  engine: string;
  left: Arm;
  right: Arm;
  status: Status;
  explanation: string | null;
  explanationClass?: string;
  detail: Record<string, unknown> | null;
}

/**
 * The SECOND registered explanation class (spec `.totem/specs/seed20-apparatus.md`
 * § G8). It applies to exactly one fixture — the synthetic malformed-facts control
 * — and it is keyed on that bundle's own `provenance.malformedFactsControl`, never
 * on a divergence SHAPE, so it cannot widen to cover a real disagreement.
 */
const MALFORMED_FACTS_CONTROL = 'MALFORMED-FACTS-CONTROL';

/**
 * The ONE registered explanation class.
 *
 * Kept deliberately narrow: it fires only when the `(rule_id, line_number)`
 * multisets AND the event streams are identical and the sole difference is the
 * ordinal — i.e. exactly the axis the shipped side has to RECONSTRUCT because the
 * shipped `Violation` carries no ordinal. Anything wider would launder a real
 * semantic divergence as "explained", which is the failure mode a differential
 * exists to prevent. If it never fires, that is the better outcome and it is
 * reported as such.
 */
function explain(
  left: NormalRow,
  right: NormalRow,
): { explanation: string; detail: Record<string, unknown> } | null {
  if (left.violations === null || right.violations === null) return null;
  const sameLines = multisetEqual(lineKeys(left.violations), lineKeys(right.violations));
  const sameEvents = multisetEqual(eventKeys(left.events ?? []), eventKeys(right.events ?? []));
  const sameStrict = multisetEqual(strictKeys(left.violations), strictKeys(right.violations));
  if (sameLines && sameEvents && !sameStrict) {
    return {
      explanation:
        'ORDINAL-DERIVATION ONLY — the (rule_id, line_number) violation multisets and the event streams are identical; the arms differ only on the ordinal, which the shipped side does not carry natively and which this comparator reconstructs from the FactBundle. Not a semantic divergence.',
      detail: {
        leftStrict: strictKeys(left.violations),
        rightStrict: strictKeys(right.violations),
        ordinalDerivation: left.ordinalDerivation ?? right.ordinalDerivation ?? null,
      },
    };
  }
  return null;
}

function comparePair(
  left: NormalRow,
  right: NormalRow,
  opts: { malformedFactsControl?: boolean } = {},
): PairResult {
  const base = {
    ruleId: left.ruleId,
    fixtureId: left.fixtureId,
    specimen: left.specimen,
    seedEntry: left.seedEntry ?? right.seedEntry ?? null,
    engine: left.engine,
    left: left.arm,
    right: right.arm,
  };

  // (G8/K5b) The malformed-facts control, carved out BEFORE the error-row branch.
  //
  // Its whole point is that every arm errors on it, so leaving it to the branch
  // below would render the one bundle that PROVES the strictness contract as an
  // UNEXPLAINED divergence — and, on the opa-vs-regorus and shipped-vs-wazero
  // pairings, would manufacture a parity divergence out of two arms behaving
  // identically and correctly. The carve-out is keyed on the FIXTURE, from the
  // bundle's own provenance, and it is narrow in the way that matters: if an arm
  // ever produced a VERDICT here instead of an error, that is reported as the
  // failure it is rather than absorbed by the class.
  if (opts.malformedFactsControl) {
    const bothErrored = left.error !== null && right.error !== null;
    return {
      ...base,
      status: bothErrored ? 'EXPLAINED-DIVERGENCE' : 'UNEXPLAINED-DIVERGENCE',
      explanation: bothErrored
        ? 'MALFORMED-FACTS CONTROL (K5b) — a synthetic bundle whose `lines[]` carries a non-string member, so `facts_wellformed` is false, the entrypoint`s `result` is UNDEFINED and every arm must raise an ERROR ROW. Both arms did. This is the strictness contract being exercised, not a divergence.'
        : null,
      explanationClass: MALFORMED_FACTS_CONTROL,
      detail: {
        reason: bothErrored
          ? 'both arms produced the expected error row'
          : 'AN ARM PRODUCED A VERDICT for the malformed control — the strictness contract did NOT hold on that arm',
        leftError: left.error,
        rightError: right.error,
      },
    };
  }

  // An error row from either side is a divergence, never a clean zero. This is
  // the strictness contract arriving at the comparator: the OPA arm turns an
  // empty result set into an error row precisely so it lands HERE.
  if (left.error !== null || right.error !== null) {
    return {
      ...base,
      status: 'UNEXPLAINED-DIVERGENCE',
      explanation: null,
      detail: {
        reason: 'ERROR ROW — an arm failed to produce a verdict',
        leftError: left.error,
        rightError: right.error,
      },
    };
  }

  const lv = strictKeys(left.violations!);
  const rv = strictKeys(right.violations!);
  const le = eventKeys(left.events!);
  const re = eventKeys(right.events!);
  const violationsEqual = multisetEqual(lv, rv);
  const eventsEqual = multisetEqual(le, re);

  if (violationsEqual && eventsEqual) {
    // `fired` derives from violations (§ Differential units) — checked rather than
    // assumed, so an arm that computed it some other way cannot slip through a
    // pair whose multisets happen to agree.
    const firedOk =
      left.fired === left.violations!.length > 0 && right.fired === right.violations!.length > 0;
    const countOk =
      left.matchCount === left.violations!.length && right.matchCount === right.violations!.length;
    if (!firedOk || !countOk) {
      return {
        ...base,
        status: 'UNEXPLAINED-DIVERGENCE',
        explanation: null,
        detail: {
          reason:
            '`fired`/`matchCount` do not DERIVE from the violation multiset on one of the arms (§ Differential units)',
          left: {
            fired: left.fired,
            matchCount: left.matchCount,
            violations: left.violations!.length,
          },
          right: {
            fired: right.fired,
            matchCount: right.matchCount,
            violations: right.violations!.length,
          },
        },
      };
    }
    return { ...base, status: 'MATCH', explanation: null, detail: null };
  }

  const ex = explain(left, right);
  if (ex) {
    return {
      ...base,
      status: 'EXPLAINED-DIVERGENCE',
      explanation: ex.explanation,
      explanationClass: 'ORDINAL-DERIVATION-ONLY',
      detail: ex.detail,
    };
  }

  return {
    ...base,
    status: 'UNEXPLAINED-DIVERGENCE',
    explanation: null,
    detail: {
      violations: violationsEqual ? 'equal' : multisetDiff(lv, rv),
      events: eventsEqual ? 'equal' : multisetDiff(le, re),
      leftViolations: lv,
      rightViolations: rv,
      leftEvents: le,
      rightEvents: re,
    },
  };
}

// ─── Detector self-test ──────────────────────────────────────────────────────

/**
 * A differential that reports 72/72 MATCH is worth exactly what its DETECTOR is
 * worth. An all-green comparator that cannot tell two different verdicts apart
 * reports the same 72/72, so the detector is exercised against synthetic MUTANTS
 * before any real row is compared.
 *
 * Each mutant perturbs exactly one axis of a known-good pair and asserts the
 * status it must produce. The ordinal mutant additionally proves the single
 * registered explanation class is NARROW: it fires for an ordinal-only
 * permutation and for nothing else here.
 */
function selfTest(checks: Checks): void {
  const base = (over: Partial<NormalRow> = {}): NormalRow => ({
    arm: 'opa',
    ruleId: 'd0815b6769304e26',
    fixtureId: 'c-corpus-fail',
    specimen: 'c',
    seedEntry: null,
    engine: 'ast-grep',
    violations: [
      { rule_id: 'd0815b6769304e26', line_number: 2, ordinal: 0 },
      { rule_id: 'd0815b6769304e26', line_number: 3, ordinal: 1 },
    ],
    events: [
      { kind: 'trigger', line: 2 },
      { kind: 'trigger', line: 3 },
    ],
    fired: true,
    matchCount: 2,
    error: null,
    ...over,
  });

  const mutants: { name: string; left: NormalRow; right: NormalRow; expect: Status }[] = [
    {
      name: 'IDENTITY — an unperturbed pair MATCHES (the detector is not stuck on "divergent")',
      left: base(),
      right: base({ arm: 'shipped' }),
      expect: 'MATCH',
    },
    {
      name: 'MUTANT — a shifted line_number is UNEXPLAINED',
      left: base(),
      right: base({
        arm: 'shipped',
        violations: [
          { rule_id: 'd0815b6769304e26', line_number: 2, ordinal: 0 },
          { rule_id: 'd0815b6769304e26', line_number: 9, ordinal: 1 },
        ],
      }),
      expect: 'UNEXPLAINED-DIVERGENCE',
    },
    {
      name: 'MUTANT — a DROPPED violation is UNEXPLAINED (multiplicity, not just membership)',
      left: base(),
      right: base({
        arm: 'shipped',
        violations: [{ rule_id: 'd0815b6769304e26', line_number: 2, ordinal: 0 }],
        matchCount: 1,
      }),
      expect: 'UNEXPLAINED-DIVERGENCE',
    },
    {
      name: 'MUTANT — an identical violation multiset with a DIVERGENT event stream is UNEXPLAINED',
      left: base(),
      right: base({ arm: 'shipped', events: [{ kind: 'trigger', line: 2 }] }),
      expect: 'UNEXPLAINED-DIVERGENCE',
    },
    {
      name: 'MUTANT — a `suppress` event where the other arm emitted `trigger` is UNEXPLAINED (kind is compared, not just line)',
      left: base(),
      right: base({
        arm: 'shipped',
        events: [
          { kind: 'trigger', line: 2 },
          { kind: 'suppress', line: 3 },
        ],
      }),
      expect: 'UNEXPLAINED-DIVERGENCE',
    },
    {
      name: 'MUTANT — an ERROR ROW is UNEXPLAINED, never a clean zero',
      left: base(),
      right: base({
        arm: 'shipped',
        violations: null,
        events: null,
        fired: null,
        matchCount: null,
        error: 'boom',
      }),
      expect: 'UNEXPLAINED-DIVERGENCE',
    },
    {
      name: 'MUTANT — `fired`/`matchCount` that do NOT derive from the violation multiset is UNEXPLAINED',
      left: base(),
      right: base({ arm: 'shipped', fired: false, matchCount: 0 }),
      expect: 'UNEXPLAINED-DIVERGENCE',
    },
    {
      name: 'MUTANT — an ORDINAL-ONLY permutation is EXPLAINED (and only this one is)',
      left: base(),
      right: base({
        arm: 'shipped',
        violations: [
          { rule_id: 'd0815b6769304e26', line_number: 2, ordinal: 1 },
          { rule_id: 'd0815b6769304e26', line_number: 3, ordinal: 0 },
        ],
      }),
      expect: 'EXPLAINED-DIVERGENCE',
    },
  ];

  for (const m of mutants) {
    const got = comparePair(m.left, m.right);
    checks.check(
      `DETECTOR ${m.name}`,
      got.status === m.expect,
      `expected ${m.expect}, got ${got.status}`,
    );
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const checks = new Checks();
  selfTest(checks);

  const shippedArt = readArtifact('shipped-verdicts.json');
  const opaArt = readArtifact('opa-verdicts.json');
  const regorusArt = readArtifact('regorus-verdicts.json');

  const bundles = new Map<string, any>();
  // (G8) The malformed-facts control set, read from each bundle's OWN provenance —
  // never a fixture id hardcoded here. A comparator that named the control itself
  // could carve out a fixture the fact producer never marked.
  const malformedFactsControls = new Set<string>();
  for (const f of fs
    .readdirSync(FACTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const rec = JSON.parse(fs.readFileSync(path.join(FACTS_DIR, f), 'utf-8'));
    bundles.set(rec.fixtureId, rec.factBundle);
    if (rec.provenance?.malformedFactsControl === true) malformedFactsControls.add(rec.fixtureId);
  }

  // (G4) the seed label, joined in from the fact index so every arm's rows carry it
  // — including the two the Rust host emits, which keep the wasmtime row shape.
  const factsIndex = readArtifact('facts-index.json') as {
    bundles: { fixtureId: string; seedEntry?: string | null }[];
  };
  const seedEntryByFixture = new Map<string, string | null>(
    factsIndex.bundles.map((b) => [b.fixtureId, b.seedEntry ?? null]),
  );

  const shipped = normaliseShipped(shippedArt.verdictRows, bundles, seedEntryByFixture);
  const opa = normaliseRego('opa', opaArt.verdictRows, seedEntryByFixture);
  const regorus = normaliseRego('regorus', regorusArt.verdictRows, seedEntryByFixture);

  // The fixture count is a DECLARED property of the arms and of the fact-bundle
  // directory, not a constant of this comparator. Deriving it means an arm that
  // dropped a fixture is reported AS THAT, once — instead of three or four
  // separate "expected 24" failures that each name the stale literal rather than
  // the arm at fault.
  const expectedRows = bundles.size;
  checks.eq(
    'the fact bundles and the OPA arm agree on the fixture count',
    opaArt.fixtureCount,
    expectedRows,
  );
  checks.eq(
    'the fact bundles and the regorus arm agree on the fixture count',
    regorusArt.fixtureCount,
    expectedRows,
  );
  checks.eq(`shipped arm produced ${expectedRows} verdict rows`, shipped.length, expectedRows);
  checks.eq(`opa arm produced ${expectedRows} verdict rows`, opa.length, expectedRows);
  checks.eq(`regorus arm produced ${expectedRows} verdict rows`, regorus.length, expectedRows);

  const key = (r: NormalRow) => `${r.ruleId}|${r.fixtureId}`;
  const byKey = (rows: NormalRow[]) => new Map(rows.map((r) => [key(r), r]));
  const S = byKey(shipped);
  const O = byKey(opa);
  const R = byKey(regorus);

  checks.eq(
    'the join key (ruleId, fixtureId) is unique on every arm',
    [S.size, O.size, R.size],
    [expectedRows, expectedRows, expectedRows],
  );
  const missing = [...S.keys()].filter((k) => !O.has(k) || !R.has(k));
  checks.eq('every shipped pair has an opa row AND a regorus row (no silent skip)', missing, []);

  // A differential over rows that all say "nothing fired" would be vacuous.
  //
  // Two claims, and only the first is about the APPARATUS. "Fires and stays silent"
  // must hold on any set worth running. "At least one row is multi-violation" is a
  // property of the RECORDS: it needs a bundle carrying two matches, and a frozen
  // record set either has one or does not. On a set with none the second half is
  // reported as the finding it is — the ast ORDINAL axis is unexercised there, so
  // the ORDINAL-DERIVATION-ONLY class cannot fire — instead of reddening the run
  // for a fact about the corpus. The `specimens` set keeps the full assertion.
  const detail = `${shipped.filter((r) => r.fired).length} fired / ${shipped.filter((r) => !r.fired).length} silent / max matchCount ${Math.max(...shipped.map((r) => r.matchCount ?? 0))}`;
  const firesAndSilences = shipped.some((r) => r.fired) && shipped.some((r) => !r.fired);
  const multiViolation = shipped.some((r) => (r.matchCount ?? 0) > 1);
  if (multiViolation || activeRecordSet() === 'specimens') {
    checks.check(
      'the corpus is DISCRIMINATING — the shipped arm both fires and stays silent, and at least one row is multi-violation',
      firesAndSilences && multiViolation,
      detail,
    );
  } else {
    checks.check(
      'the corpus is DISCRIMINATING — the shipped arm both fires and stays silent',
      firesAndSilences,
      detail,
    );
    checks.check(
      'MULTI-VIOLATION — SKIPPED with a named reason: NO bundle in this record set carries more than one violation, so the ast ORDINAL axis (§ Lowering 1, "the ordinal is the match index") is UNEXERCISED here and the ORDINAL-DERIVATION-ONLY class cannot fire (a corpus property of the frozen set, not an apparatus defect)',
      true,
      detail,
    );
  }

  const pairs: PairResult[] = [];
  for (const k of [...S.keys()].sort()) {
    const opts = { malformedFactsControl: malformedFactsControls.has(S.get(k)!.fixtureId) };
    pairs.push(comparePair(S.get(k)!, O.get(k)!, opts));
    pairs.push(comparePair(S.get(k)!, R.get(k)!, opts));
    // opa vs regorus: the arm-to-arm differential the spec asks for separately.
    pairs.push(comparePair(O.get(k)!, R.get(k)!, opts));
  }

  const by = (l: Arm, r: Arm) => pairs.filter((p) => p.left === l && p.right === r);
  const tally = (rows: PairResult[]) => ({
    MATCH: rows.filter((p) => p.status === 'MATCH').length,
    'EXPLAINED-DIVERGENCE': rows.filter((p) => p.status === 'EXPLAINED-DIVERGENCE').length,
    'UNEXPLAINED-DIVERGENCE': rows.filter((p) => p.status === 'UNEXPLAINED-DIVERGENCE').length,
  });

  const summary = {
    'shipped-vs-opa': tally(by('shipped', 'opa')),
    'shipped-vs-regorus': tally(by('shipped', 'regorus')),
    'opa-vs-regorus': tally(by('opa', 'regorus')),
    total: tally(pairs),
  };

  const unexplained = pairs.filter((p) => p.status === 'UNEXPLAINED-DIVERGENCE');
  const explained = pairs.filter((p) => p.status === 'EXPLAINED-DIVERGENCE');

  // ── (G8) the whole-run ERROR ROW accounting ──
  //
  // "0 outside K5b" is only a claim if the K5b bundle is subtracted EXPLICITLY and
  // the remainder is asserted to be zero. Counted per arm from the arms' own rows,
  // so the number is the hosts' report and not the comparator's opinion.
  const armRows: [Arm, NormalRow[]][] = [
    ['shipped', shipped],
    ['opa', opa],
    ['regorus', regorus],
  ];
  const errorRowAccounting = {
    contract:
      'spec `.totem/specs/seed20-apparatus.md` § G8 — the whole-run errorRows count EXCLUDES exactly the malformed-facts control bundle when the summary says "0 outside K5b".',
    k5bControlFixtureIds: [...malformedFactsControls].sort(),
    perArm: Object.fromEntries(
      armRows.map(([arm, rowsOfArm]) => {
        const errored = rowsOfArm.filter((r) => r.error !== null);
        const fromControl = errored.filter((r) => malformedFactsControls.has(r.fixtureId));
        return [
          arm,
          {
            total: errored.length,
            fromK5bControl: fromControl.length,
            outsideK5b: errored.length - fromControl.length,
            outsideK5bFixtureIds: errored
              .filter((r) => !malformedFactsControls.has(r.fixtureId))
              .map((r) => r.fixtureId)
              .sort(),
          },
        ];
      }),
    ),
  };
  const outsideK5b = armRows.flatMap(([, rowsOfArm]) =>
    rowsOfArm.filter((r) => r.error !== null && !malformedFactsControls.has(r.fixtureId)),
  );
  checks.eq(
    'ERROR ROWS — zero outside the K5b malformed-facts control, on every arm',
    outsideK5b.map((r) => `${r.arm}/${r.fixtureId}`).sort(),
    [],
  );
  if (malformedFactsControls.size > 0) {
    checks.eq(
      `ERROR ROWS — the K5b control (${[...malformedFactsControls].join(', ')}) produced EXACTLY ONE error row on each of the three arms (never a clean zero, never a missing row)`,
      armRows.map(
        ([arm, rowsOfArm]) =>
          `${arm}:${rowsOfArm.filter((r) => r.error !== null && malformedFactsControls.has(r.fixtureId)).length}`,
      ),
      ['shipped:1', 'opa:1', 'regorus:1'],
    );
  }

  for (const [label, t] of Object.entries(summary)) {
    console.log(
      `${label.padEnd(20)} MATCH=${t.MATCH}  EXPLAINED=${t['EXPLAINED-DIVERGENCE']}  UNEXPLAINED=${t['UNEXPLAINED-DIVERGENCE']}`,
    );
  }

  checks.eq(
    'shipped-vs-opa — every pair MATCHES (the ruled PASS criterion: identical violation multisets AND event streams on every fixture)',
    summary['shipped-vs-opa']['UNEXPLAINED-DIVERGENCE'],
    0,
  );
  checks.eq(
    'shipped-vs-regorus — no unexplained divergence',
    summary['shipped-vs-regorus']['UNEXPLAINED-DIVERGENCE'],
    0,
  );
  checks.eq(
    'opa-vs-regorus — no unexplained divergence (a divergence here is a finding ABOUT regorus)',
    summary['opa-vs-regorus']['UNEXPLAINED-DIVERGENCE'],
    0,
  );

  const out = writeArtifact('differential-report.json', {
    generatedBy: 'spikes/spine-adopt/src/compare.mts',
    contract:
      'rego/LOWERING.md § Comparator + spec § Differential units ("a VERDICT is the violation MULTISET", "`fired` derives from violations")',
    comparisonKey: {
      violations: '(rule_id, line_number, ordinal) as a MULTISET',
      events: '(kind, line_number) as a MULTISET',
      ordinalOnTheShippedArm:
        'DERIVED — the shipped Violation carries no ordinal. regex ⇒ 0; ast-grep ⇒ the index of the FactBundle astMatches entry the violation pairs with, matched greedily by lineNumber. An unpairable violation aborts the run rather than defaulting to 0.',
      eventProjection:
        'The shipped event context `line` is the line NUMBER (the Violation `line` is the matched TEXT — projecting the wrong one would compare strings against integers).',
    },
    armProvenance: {
      shipped: shippedArt.generatedBy,
      opa: `${opaArt.generatedBy} — ${opaArt.host?.crate}`,
      regorus: `${regorusArt.generatedBy} — ${regorusArt.host?.crate}`,
    },
    explanationClasses: [
      {
        id: 'ORDINAL-DERIVATION-ONLY',
        fires:
          'the (rule_id, line_number) multisets and the event streams are identical and only the ordinal differs',
        timesFired: explained.filter((p) => p.explanationClass === 'ORDINAL-DERIVATION-ONLY')
          .length,
        rationale:
          'A wider rule would launder a real semantic divergence as "explained", which is the failure a differential exists to prevent.',
      },
      {
        id: MALFORMED_FACTS_CONTROL,
        fires:
          "the pair's fixture is a synthetic malformed-facts bundle (marked `provenance.malformedFactsControl` by the fact producer) AND both arms produced the error row it exists to force",
        timesFired: explained.filter((p) => p.explanationClass === MALFORMED_FACTS_CONTROL).length,
        rationale:
          'Spec § G8 (K5b). The control exists to make every arm error, so without a carve-out the one bundle that PROVES the strictness contract would render as an unexplained divergence and, arm-to-arm, would manufacture a parity divergence out of two arms behaving identically. Keyed on the FIXTURE, never on a divergence shape, and it does NOT fire when an arm produced a verdict instead of an error — that is reported as the failure it is.',
      },
    ],
    errorRows: errorRowAccounting,
    summary,
    unexplained,
    explained,
    pairs,
    checks: checks.rows,
  });

  console.log(`\ndifferential report -> ${out}`);

  if (unexplained.length > 0) {
    console.error(`\n${unexplained.length} UNEXPLAINED DIVERGENCE(S):`);
    for (const u of unexplained) {
      console.error(
        `  ${u.left} vs ${u.right}  ${u.specimen}/${u.fixtureId} (${u.engine})\n    ${JSON.stringify(u.detail)}`,
      );
    }
  }
  checks.finish('compare');
}

main();
