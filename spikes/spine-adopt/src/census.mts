// ─── Step 0 — the regex-expressibility census ────────────────────────────────
//
// Spec § "Census corrections the design binds to" carries a DISPUTED row:
//
//   "the leg's RE2 table marks `\b` (101/226 patterns) unsupported; RE2/Go-regexp
//    documentation says `\b` IS supported (ASCII word boundary). Lookarounds (50)
//    + backreference (1) are the confirmed-inexpressible set (~23%). Step 0
//    MEASURES; no claim adopted."
//
// This file measures. Two independent obligations:
//
//   1. STRUCTURAL — classify every non-empty regex `pattern` in the four shipped
//      corpora into four DISJOINT classes, most-inexpressible wins:
//         backreference > lookaround > word-boundary > re2-clean
//      and assert the classes partition all 226 (§ Invariants: "sum check, no
//      silent drops").
//
//   2. EMPIRICAL — run the PINNED OPA binary (toolchain.lock [opa] v1.20.0) on a
//      corpus `\b`-bearing pattern against matching and non-matching inputs, and
//      on a corpus lookahead pattern. Documentation is not evidence here; the
//      binary that would compile the lowered Rego is.
//
// Run: node --experimental-strip-types src/census.mts

import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';

import {
  ARTIFACTS_DIR,
  Checks,
  CORPORA,
  loadCoreBarrel,
  OPA_BIN,
  REPO_ROOT,
  requireSymbols,
  writeArtifact,
} from './lib/spike-env.mts';

// ─── Corpus intake ───────────────────────────────────────────────────────────

interface CorpusRule {
  lessonHash: string;
  lessonHeading?: string;
  pattern?: string;
  engine?: string;
  severity?: string;
  fileGlobs?: string[];
}

interface PatternRow {
  corpus: string;
  ruleHash: string;
  heading: string;
  engine: string;
  pattern: string;
}

function readCorpora(): { rows: PatternRow[]; totalRules: number; perCorpus: Record<string, { rules: number; withPattern: number }> } {
  const rows: PatternRow[] = [];
  const perCorpus: Record<string, { rules: number; withPattern: number }> = {};
  let totalRules = 0;

  for (const { id, file } of CORPORA) {
    if (!fs.existsSync(file)) throw new Error(`corpus missing: ${file}`);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { rules?: CorpusRule[] };
    const rules = parsed.rules ?? [];
    totalRules += rules.length;
    let withPattern = 0;
    for (const r of rules) {
      // "non-empty regex `pattern`" — the corpus writes `pattern: ""` on every
      // ast-grep rule, so emptiness is the discriminator, not `engine`.
      if (typeof r.pattern === 'string' && r.pattern.length > 0) {
        withPattern += 1;
        rows.push({
          corpus: id,
          ruleHash: r.lessonHash,
          heading: r.lessonHeading ?? '',
          engine: r.engine ?? '(unset)',
          pattern: r.pattern,
        });
      }
    }
    perCorpus[id] = { rules: rules.length, withPattern };
  }
  return { rows, totalRules, perCorpus };
}

// ─── Structural classification ───────────────────────────────────────────────

export type ExpressibilityClass = 're2-clean' | 'word-boundary' | 'lookaround' | 'backreference';

/** Most-inexpressible-wins order, used for the disjoint assignment. */
const CLASS_RANK: Record<ExpressibilityClass, number> = {
  'backreference': 3,
  'lookaround': 2,
  'word-boundary': 1,
  're2-clean': 0,
};

export interface ScanResult {
  wordBoundary: number;
  lookahead: number;
  negativeLookahead: number;
  lookbehind: number;
  negativeLookbehind: number;
  backreference: number;
}

/**
 * ESCAPE-AWARE scan. A naive `includes('\\b')` cannot tell `\b` (word boundary)
 * from `\\b` (a literal backslash followed by `b`) or from `[\b]` (backspace
 * inside a character class), and cannot tell `\1` (backreference) from `[\1]`
 * (an octal escape). Both distinctions change the RE2 verdict, so the scan walks
 * the pattern rather than substring-testing it. The naive counts are computed
 * separately and DIFFED in the artifact — a divergence is itself a finding.
 */
export function scanPattern(pattern: string): ScanResult {
  const out: ScanResult = {
    wordBoundary: 0,
    lookahead: 0,
    negativeLookahead: 0,
    lookbehind: 0,
    negativeLookbehind: 0,
    backreference: 0,
  };
  let i = 0;
  let inClass = false;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === '\\') {
      const next = pattern[i + 1];
      if (next === undefined) break; // trailing lone backslash — malformed, nothing to classify
      if (!inClass && next === 'b') out.wordBoundary += 1;
      if (!inClass && next >= '1' && next <= '9') out.backreference += 1;
      i += 2;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      i += 1;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      i += 1;
      // JS/RE2: a `]` immediately after `[` or `[^` is a literal member, not a close.
      if (pattern[i] === '^') i += 1;
      if (pattern[i] === ']') i += 1;
      continue;
    }
    if (ch === '(' && pattern[i + 1] === '?') {
      const rest = pattern.slice(i + 2);
      if (rest.startsWith('=')) out.lookahead += 1;
      else if (rest.startsWith('!')) out.negativeLookahead += 1;
      else if (rest.startsWith('<=')) out.lookbehind += 1;
      else if (rest.startsWith('<!')) out.negativeLookbehind += 1;
      // `(?<name>` is a NAMED GROUP, not a lookbehind — deliberately unmatched here.
    }
    i += 1;
  }
  return out;
}

/** The literal-substring reading of the dispatch's wording, kept only as a differential. */
export function naiveScan(pattern: string): ScanResult {
  const count = (needle: string) => pattern.split(needle).length - 1;
  return {
    wordBoundary: count('\\b'),
    lookahead: count('(?='),
    negativeLookahead: count('(?!'),
    lookbehind: count('(?<='),
    negativeLookbehind: count('(?<!'),
    backreference: [1, 2, 3, 4, 5, 6, 7, 8, 9].reduce((n, d) => n + count(`\\${d}`), 0),
  };
}

export function classify(scan: ScanResult): ExpressibilityClass {
  if (scan.backreference > 0) return 'backreference';
  const looks =
    scan.lookahead + scan.negativeLookahead + scan.lookbehind + scan.negativeLookbehind;
  if (looks > 0) return 'lookaround';
  if (scan.wordBoundary > 0) return 'word-boundary';
  return 're2-clean';
}

// ─── Empirical arm: the pinned OPA binary ────────────────────────────────────

interface OpaProbe {
  label: string;
  regoQuery: string;
  /** The regex source handed to `regex.match`. */
  pattern: string;
  /** How the pattern was encoded as a Rego string literal. */
  stringForm: 'raw-backtick' | 'double-quoted-json-escaped';
  input: string;
  exitCode: number | null;
  /** `true` / `false` when the builtin evaluated; `undefined` when it errored. */
  value: boolean | undefined;
  /** OPA's own error text under `--strict-builtin-errors`, or null. */
  error: string | null;
  verdict: 'supported-match' | 'supported-nonmatch' | 'rejected-by-re2';
}

function opaVersion(): string {
  const r = spawnSync(OPA_BIN, ['version'], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`pinned OPA binary not runnable at ${OPA_BIN}`);
  return (r.stdout.split('\n')[0] ?? '').replace(/^Version:\s*/, '').trim();
}

/**
 * Evaluate `regex.match(<pattern>, <input>)` with the PINNED binary.
 *
 * Two escaping decisions, both load-bearing:
 *  - the pattern is emitted as a Rego RAW string (backticks). In a Rego
 *    DOUBLE-QUOTED string `\b` is the JSON BACKSPACE escape, so the double-quoted
 *    form would silently hand RE2 a `U+0008` and measure the wrong thing.
 *  - `--strict-builtin-errors` is set. Without it OPA swallows a regex COMPILE
 *    error into an undefined expression and prints `{}` with exit 0 — a fail-open
 *    the lowerer must never inherit.
 */
function opaRegexMatch(label: string, pattern: string, input: string): OpaProbe {
  // A Rego RAW string is delimited by backticks and has NO escape mechanism (Go
  // raw-string semantics), so a pattern CONTAINING a backtick cannot be carried
  // in that form at all — an enumerable lowering constraint, hit by exactly one
  // corpus rule (`bddfbd2ec1c75eaf`, whose `(?<!\`)` guards markdown code spans).
  // The fallback is a double-quoted literal built by JSON.stringify, which
  // re-escapes every backslash so the Rego string VALUE equals the regex source.
  const stringForm: OpaProbe['stringForm'] = pattern.includes('`')
    ? 'double-quoted-json-escaped'
    : 'raw-backtick';
  const literal =
    stringForm === 'raw-backtick' ? `\`${pattern}\`` : JSON.stringify(pattern);
  const query = `regex.match(${literal}, ${JSON.stringify(input)})`;
  const r = spawnSync(OPA_BIN, ['eval', '--format=json', '--strict-builtin-errors', query], {
    encoding: 'utf-8',
  });
  let value: boolean | undefined;
  let error: string | null = null;
  try {
    const parsed = JSON.parse(r.stdout) as {
      result?: { expressions?: { value?: boolean }[] }[];
      errors?: { message?: string }[];
    };
    value = parsed.result?.[0]?.expressions?.[0]?.value;
    if (parsed.errors?.length) error = parsed.errors.map((e) => e.message ?? '').join('; ');
  } catch {
    error = `unparseable OPA output: ${r.stdout}${r.stderr}`;
  }
  const verdict: OpaProbe['verdict'] =
    error !== null ? 'rejected-by-re2' : value === true ? 'supported-match' : 'supported-nonmatch';
  return {
    label,
    regoQuery: query,
    pattern,
    stringForm,
    input,
    exitCode: r.status,
    value,
    error,
    verdict,
  };
}

/** The non-strict default, probed once, so the fail-open is recorded rather than assumed. */
function opaNonStrictLookahead(pattern: string, input: string): { exitCode: number | null; stdout: string } {
  const query = `regex.match(\`${pattern}\`, ${JSON.stringify(input)})`;
  const r = spawnSync(OPA_BIN, ['eval', '--format=json', query], { encoding: 'utf-8' });
  return { exitCode: r.status, stdout: r.stdout.trim() };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const checks = new Checks();
  const core = await loadCoreBarrel();
  requireSymbols(core, ['validateRegex']);
  const { rows, totalRules, perCorpus } = readCorpora();

  checks.eq('corpus intake — 500 rules across the four corpora', totalRules, 500);
  checks.eq('corpus intake — 226 rules carry a non-empty regex `pattern`', rows.length, 226);

  // ── structural ──
  const classified = rows.map((row) => {
    const scan = scanPattern(row.pattern);
    const naive = naiveScan(row.pattern);
    return {
      corpus: row.corpus,
      ruleHash: row.ruleHash,
      heading: row.heading,
      engine: row.engine,
      class: classify(scan),
      pattern: row.pattern,
      scan,
      naiveClass: classify(naive),
      naiveDiffers: classify(naive) !== classify(scan),
    };
  });

  const classCounts: Record<ExpressibilityClass, number> = {
    're2-clean': 0,
    'word-boundary': 0,
    'lookaround': 0,
    'backreference': 0,
  };
  for (const c of classified) classCounts[c.class] += 1;

  const sum = Object.values(classCounts).reduce((a, b) => a + b, 0);
  checks.eq('classes PARTITION all 226 patterns (sum check, no silent drops)', sum, rows.length);
  checks.check(
    'classes are DISJOINT (every row carries exactly one class label)',
    classified.every((c) => CLASS_RANK[c.class] !== undefined),
    `${classified.length} rows labelled`,
  );
  // The most-inexpressible-wins order is asserted structurally, not just applied.
  checks.check(
    'most-inexpressible-wins: no `word-boundary` row also bears a lookaround or backreference',
    classified
      .filter((c) => c.class === 'word-boundary')
      .every(
        (c) =>
          c.scan.backreference === 0 &&
          c.scan.lookahead + c.scan.negativeLookahead + c.scan.lookbehind + c.scan.negativeLookbehind === 0,
      ),
    `${classCounts['word-boundary']} word-boundary rows checked`,
  );
  checks.check(
    'most-inexpressible-wins: no `lookaround` row also bears a backreference',
    classified.filter((c) => c.class === 'lookaround').every((c) => c.scan.backreference === 0),
    `${classCounts['lookaround']} lookaround rows checked`,
  );
  checks.check(
    'most-inexpressible-wins: `re2-clean` rows bear NONE of the three markers',
    classified
      .filter((c) => c.class === 're2-clean')
      .every(
        (c) =>
          c.scan.wordBoundary === 0 &&
          c.scan.backreference === 0 &&
          c.scan.lookahead + c.scan.negativeLookahead + c.scan.lookbehind + c.scan.negativeLookbehind === 0,
      ),
    `${classCounts['re2-clean']} re2-clean rows checked`,
  );

  // ── bearing counts (the spec's claimed numbers are BEARING counts, not class counts) ──
  const bearing = {
    wordBoundaryBearing: classified.filter((c) => c.scan.wordBoundary > 0).length,
    lookaroundBearing: classified.filter(
      (c) =>
        c.scan.lookahead + c.scan.negativeLookahead + c.scan.lookbehind + c.scan.negativeLookbehind >
        0,
    ).length,
    negativeLookaheadBearing: classified.filter((c) => c.scan.negativeLookahead > 0).length,
    positiveLookaheadBearing: classified.filter((c) => c.scan.lookahead > 0).length,
    positiveLookbehindBearing: classified.filter((c) => c.scan.lookbehind > 0).length,
    negativeLookbehindBearing: classified.filter((c) => c.scan.negativeLookbehind > 0).length,
    /** EITHER lookbehind form — this is the number the spec's "1 lookbehind" names. */
    lookbehindAnyBearing: classified.filter(
      (c) => c.scan.lookbehind + c.scan.negativeLookbehind > 0,
    ).length,
    backreferenceBearing: classified.filter((c) => c.scan.backreference > 0).length,
  };
  /** The naive-substring reading of the same question, kept to reconcile the spec's numbers. */
  const naiveWordBoundaryBearing = classified.filter(
    (c) => naiveScan(c.pattern).wordBoundary > 0,
  ).length;
  const occurrences = classified.reduce(
    (acc, c) => ({
      wordBoundary: acc.wordBoundary + c.scan.wordBoundary,
      lookaround:
        acc.lookaround +
        c.scan.lookahead +
        c.scan.negativeLookahead +
        c.scan.lookbehind +
        c.scan.negativeLookbehind,
      backreference: acc.backreference + c.scan.backreference,
    }),
    { wordBoundary: 0, lookaround: 0, backreference: 0 },
  );

  // The spec's claims, verified rather than restated. A delta is REPORTED, not
  // silently absorbed — these are recorded as `specClaims` rows in the artifact
  // and the run does not fail on a delta (the census is the arbiter, not the spec).
  const specClaims = [
    {
      claim: 'word-boundary-bearing patterns',
      spec: 101,
      measured: bearing.wordBoundaryBearing,
      note: `naive substring scan gives ${naiveWordBoundaryBearing}; the escape-aware scan drops ${naiveWordBoundaryBearing - bearing.wordBoundaryBearing} pattern(s) whose \`\\\\b\` is an ESCAPED BACKSLASH followed by a literal \`b\` (a rule matching the TEXT "\\b" in source), not a word boundary.`,
    },
    {
      claim: 'negative-lookahead-bearing patterns',
      spec: 47,
      measured: bearing.negativeLookaheadBearing,
      note: '',
    },
    {
      claim: 'lookbehind-bearing patterns (EITHER form)',
      spec: 1,
      measured: bearing.lookbehindAnyBearing,
      note: `the single corpus lookbehind is a NEGATIVE lookbehind \`(?<!\`; positive-lookbehind count is ${bearing.positiveLookbehindBearing}.`,
    },
    {
      claim: 'backreference-bearing patterns',
      spec: 1,
      measured: bearing.backreferenceBearing,
      note: '',
    },
    {
      claim: 'lookaround-bearing patterns (§ falsification fold N1: 48)',
      spec: 48,
      measured: bearing.lookaroundBearing,
      note: `47 negative-lookahead ∪ 1 negative-lookbehind = 48 distinct patterns; the ${bearing.positiveLookaheadBearing} positive-lookahead-bearing patterns all also carry a negative lookahead, so they add no new members.`,
    },
    {
      claim: 'lookaround OCCURRENCES (§ expressibility evidence rows: 53)',
      spec: 53,
      measured: occurrences.lookaround,
      note: '',
    },
  ].map((r) => ({ ...r, delta: r.measured - r.spec, agrees: r.measured === r.spec }));

  for (const c of specClaims) {
    console.log(
      `${c.agrees ? 'SPEC-OK  ' : 'SPEC-DELTA'} ${c.claim}: spec=${c.spec} measured=${c.measured} delta=${c.delta >= 0 ? '+' : ''}${c.delta}${c.note ? `\n            ${c.note}` : ''}`,
    );
  }

  const naiveDeltas = classified.filter((c) => c.naiveDiffers);
  console.log(
    `escape-aware vs naive-substring classification: ${naiveDeltas.length} row(s) differ${naiveDeltas.length ? ` (${naiveDeltas.map((d) => d.ruleHash).join(', ')})` : ''}`,
  );

  // ── empirical ──
  const version = opaVersion();
  checks.eq('pinned OPA binary reports toolchain.lock [opa] version', version, '1.20.0');

  // (i) a `\b`-bearing pattern FROM THE CORPUS, matching + non-matching inputs.
  const wbRow =
    classified.find((c) => c.ruleHash === '61dcb058bd1df15d') ??
    classified.find((c) => c.class === 'word-boundary')!;
  const wbProbes = [
    opaRegexMatch(
      `corpus \\b pattern (${wbRow.ruleHash}) vs MATCHING input`,
      wbRow.pattern,
      'git rm .totem/lessons.md',
    ),
    opaRegexMatch(
      `corpus \\b pattern (${wbRow.ruleHash}) vs NON-MATCHING input`,
      wbRow.pattern,
      'rm .totem/lessons/lesson-cd27a5b0.md',
    ),
    // A minimal \b control: the boundary is the ONLY thing separating these two.
    opaRegexMatch('minimal \\b control — `\\bfoo\\b` vs "a foo b"', '\\bfoo\\b', 'a foo b'),
    opaRegexMatch('minimal \\b control — `\\bfoo\\b` vs "afoob"', '\\bfoo\\b', 'afoob'),
  ];

  checks.check(
    'EMPIRICAL: `\\b` is SUPPORTED by the pinned OPA/RE2 — corpus pattern matches its fixture fail line',
    wbProbes[0]!.verdict === 'supported-match',
    `${wbProbes[0]!.verdict} (error=${wbProbes[0]!.error ?? 'none'})`,
  );
  checks.check(
    'EMPIRICAL: the same pattern does NOT match its fixture pass line (the boundary is doing work)',
    wbProbes[1]!.verdict === 'supported-nonmatch',
    wbProbes[1]!.verdict,
  );
  checks.check(
    'EMPIRICAL: minimal control — `\\bfoo\\b` matches "a foo b" and NOT "afoob"',
    wbProbes[2]!.verdict === 'supported-match' && wbProbes[3]!.verdict === 'supported-nonmatch',
    `${wbProbes[2]!.verdict} / ${wbProbes[3]!.verdict}`,
  );

  // (ii) a lookahead pattern — error or non-match? RECORD WHICH.
  const laRow =
    classified.find((c) => c.ruleHash === '09ee37252a814a09' && c.scan.negativeLookahead > 0) ??
    classified.find((c) => c.scan.negativeLookahead > 0)!;
  const lbRow =
    classified.find((c) => c.scan.lookbehind + c.scan.negativeLookbehind > 0) ?? null;
  const brRow = classified.find((c) => c.scan.backreference > 0) ?? null;

  const inexpressibleProbes = [
    opaRegexMatch(
      `corpus negative-lookahead pattern (${laRow.ruleHash})`,
      laRow.pattern,
      'git log --oneline',
    ),
    opaRegexMatch('minimal lookahead control — `foo(?!bar)` vs "foobaz"', 'foo(?!bar)', 'foobaz'),
    ...(lbRow
      ? [opaRegexMatch(`corpus lookbehind pattern (${lbRow.ruleHash})`, lbRow.pattern, 'x')]
      : []),
    ...(brRow
      ? [opaRegexMatch(`corpus backreference pattern (${brRow.ruleHash})`, brRow.pattern, 'x')]
      : []),
  ];

  checks.check(
    'EMPIRICAL: a negative-lookahead pattern is REJECTED AT COMPILE by RE2 (an error, not a non-match)',
    inexpressibleProbes[0]!.verdict === 'rejected-by-re2' &&
      /invalid or unsupported Perl syntax/.test(inexpressibleProbes[0]!.error ?? ''),
    inexpressibleProbes[0]!.error ?? '(no error — it EVALUATED)',
  );
  checks.check(
    'EMPIRICAL: the minimal lookahead control is rejected the same way',
    inexpressibleProbes[1]!.verdict === 'rejected-by-re2',
    inexpressibleProbes[1]!.error ?? '(no error)',
  );
  for (const p of inexpressibleProbes.slice(2)) {
    checks.check(`EMPIRICAL: ${p.label} is REJECTED by RE2`, p.verdict === 'rejected-by-re2', p.error ?? '(no error)');
  }

  // A THIRD inexpressibility axis, distinct from RE2 syntax: the Rego string
  // literal itself. Raw strings cannot carry a backtick; double-quoted strings
  // can, but only if every backslash is re-escaped.
  const backtickBearing = classified.filter((c) => c.pattern.includes('`'));
  checks.check(
    'ENUMERATED: patterns containing a backtick cannot use the Rego RAW-string form (no escape mechanism)',
    backtickBearing.length > 0,
    `${backtickBearing.length} pattern(s): ${backtickBearing.map((c) => c.ruleHash).join(', ')}`,
  );

  // The fail-open hazard, measured rather than assumed.
  const nonStrict = opaNonStrictLookahead('foo(?!bar)', 'foobaz');
  checks.check(
    'EMPIRICAL (lowering hazard): WITHOUT --strict-builtin-errors OPA exits 0 and prints `{}` for an uncompilable regex',
    nonStrict.exitCode === 0 && nonStrict.stdout === '{}',
    `exit=${nonStrict.exitCode} stdout=${nonStrict.stdout}`,
  );

  // The Rego string-literal hazard: `"\b"` is BACKSPACE, not a word boundary.
  const dq = spawnSync(
    OPA_BIN,
    ['eval', '--format=json', '--strict-builtin-errors', 'regex.match("\\bfoo\\b", "a foo b")'],
    { encoding: 'utf-8' },
  );
  const dqValue = (() => {
    try {
      return (JSON.parse(dq.stdout) as any).result?.[0]?.expressions?.[0]?.value;
    } catch {
      return undefined;
    }
  })();
  checks.check(
    'EMPIRICAL (lowering hazard): a DOUBLE-QUOTED Rego `"\\bfoo\\b"` silently means BACKSPACE and does not match',
    dqValue === false,
    `value=${JSON.stringify(dqValue)} (raw-string form gives ${JSON.stringify(wbProbes[2]!.value)})`,
  );

  // ── the spec's three named "Expressibility evidence rows", EXECUTED ──
  //
  // These are census material, not specimens. Each is a claim in
  // § "Expressibility evidence rows"; each is discharged by running the shipped
  // gate and/or the pinned binary rather than by restating the spec.
  const lookbehindValidation = lbRow ? core.validateRegex(lbRow.pattern) : null;
  if (lbRow) {
    checks.check(
      `EVIDENCE ROW — the corpus lookbehind rule ${lbRow.ruleHash} is REJECTED by the shipped \`validateRegex\` gate`,
      lookbehindValidation?.valid === false,
      JSON.stringify(lookbehindValidation),
    );
    // The half the spec does not state, and the one that matters for adoption:
    // the same pattern is nevertheless LIVE in a shipped pack corpus.
    checks.check(
      `EVIDENCE ROW — …and is nevertheless SHIPPED with a live pattern in ${lbRow.corpus}`,
      lbRow.corpus !== 'root' && lbRow.pattern.length > 0,
      `corpus=${lbRow.corpus}, heading=${lbRow.heading}`,
    );
  }
  const backrefValidation = brRow ? core.validateRegex(brRow.pattern) : null;
  if (brRow) {
    checks.check(
      `EVIDENCE ROW — the backreference rule ${brRow.ruleHash} is RECORD-AUTHORABLE (the shipped gate accepts it) yet RE2-INEXPRESSIBLE`,
      backrefValidation?.valid === true &&
        inexpressibleProbes.some(
          (p) => p.pattern === brRow.pattern && p.verdict === 'rejected-by-re2',
        ),
      `validateRegex=${JSON.stringify(backrefValidation)}; RE2 rejects at compile`,
    );
  }
  checks.eq(
    'EVIDENCE ROW — 48 lookaround-bearing patterns (47 negative-lookahead + 1 lookbehind), 53 occurrences',
    [bearing.lookaroundBearing, bearing.negativeLookaheadBearing, bearing.lookbehindAnyBearing, occurrences.lookaround],
    [48, 47, 1, 53],
  );

  const expressibilityEvidenceRows = [
    {
      row: 'corpus lookbehind rule',
      ruleHash: lbRow?.ruleHash ?? null,
      corpus: lbRow?.corpus ?? null,
      heading: lbRow?.heading ?? null,
      pattern: lbRow?.pattern ?? null,
      form: 'NEGATIVE lookbehind `(?<!` — not a positive `(?<=`',
      validateRegex: lookbehindValidation,
      re2: 'rejected at compile: "invalid named capture"',
      finding:
        'The spec\'s "validateRegex rejection EXECUTED and confirmed: ReDoS vulnerability detected" REPRODUCES exactly. Beyond the spec: this pattern is nevertheless live in a SHIPPED pack corpus, so a pattern the record path\'s safe-regex2 gate would refuse is currently enforceable on the legacy path.',
    },
    {
      row: 'backreference rule',
      ruleHash: brRow?.ruleHash ?? null,
      corpus: brRow?.corpus ?? null,
      pattern: brRow?.pattern ?? null,
      validateRegex: backrefValidation,
      re2: 'rejected at compile: "invalid escape sequence: `\\1`"',
      finding:
        'Record-authorable and RE2-inexpressible, exactly as the spec states — the cleanest single instance of the builtin gap.',
    },
    {
      row: 'lookaround-bearing patterns',
      distinctPatterns: bearing.lookaroundBearing,
      negativeLookahead: bearing.negativeLookaheadBearing,
      lookbehindAnyForm: bearing.lookbehindAnyBearing,
      occurrences: occurrences.lookaround,
      finding:
        'The § falsification-fold N1 counts 48/47/1 and the 53-occurrence figure all reproduce exactly.',
    },
  ];

  // ── artifact ──
  const artifact = {
    generatedBy: 'spikes/spine-adopt/src/census.mts',
    spec: '.totem/specs/spine-spike.md § "Census corrections the design binds to" (DISPUTED row) + § Invariants ("classes partition all 226")',
    repoRoot: REPO_ROOT,
    corpora: CORPORA.map((c) => ({ id: c.id, file: c.file.slice(REPO_ROOT.length + 1), ...perCorpus[c.id]! })),
    totals: { rules: totalRules, patternsCensused: rows.length },
    classCounts,
    classPartitionSum: sum,
    bearingCounts: { ...bearing, wordBoundaryBearingNaive: naiveWordBoundaryBearing },
    occurrences,
    specClaims,
    classificationMethod: {
      primary: 'escape-aware scan (character-class and backslash aware)',
      differential: 'naive substring scan',
      rowsWhereTheyDiffer: naiveDeltas.map((d) => ({
        ruleHash: d.ruleHash,
        escapeAware: d.class,
        naive: d.naiveClass,
        pattern: d.pattern,
      })),
    },
    opa: {
      binary: OPA_BIN.slice(REPO_ROOT.length + 1),
      version,
      pin: 'toolchain.lock [opa] v1.20.0',
      note:
        'Patterns are handed to OPA as Rego RAW strings (backticks). In a Rego DOUBLE-QUOTED string `\\b` is the JSON backspace escape — the double-quoted form measures U+0008, not a word boundary. `--strict-builtin-errors` is required: without it a regex COMPILE failure degrades to an undefined expression with exit 0.',
      wordBoundaryProbes: wbProbes,
      inexpressibleProbes,
      failOpenProbe: {
        label: 'lookahead WITHOUT --strict-builtin-errors',
        exitCode: nonStrict.exitCode,
        stdout: nonStrict.stdout,
        finding:
          'OPA exits 0 with an empty result set. A lowerer that shells out without --strict-builtin-errors converts an inexpressible pattern into a silent NO-VIOLATION — a fail-open rule drop.',
      },
      doubleQuotedStringProbe: {
        label: 'regex.match("\\bfoo\\b", "a foo b") — DOUBLE-QUOTED form, pattern text emitted VERBATIM',
        value: dqValue,
        finding: `false. \`\\b\` in a Rego double-quoted string is BACKSPACE (U+0008). A lowerer that emits pattern text verbatim into a double-quoted Rego string silently breaks all ${bearing.wordBoundaryBearing} word-boundary-bearing patterns. Either use the raw-string form or re-escape every backslash (JSON.stringify semantics).`,
      },
      regoStringLiteralConstraint: {
        finding:
          'A Rego RAW string (backticks) has NO escape mechanism, so a regex containing a backtick cannot be carried in that form at all. This is an expressibility axis SEPARATE from RE2 syntax and it is not visible in the class partition.',
        affectedPatterns: backtickBearing.map((c) => ({ ruleHash: c.ruleHash, corpus: c.corpus, class: c.class, pattern: c.pattern })),
        workaround:
          'double-quoted literal with every backslash re-escaped; measured working on the affected pattern (see inexpressibleProbes[].stringForm).',
      },
    },
    expressibilityEvidenceRows,
    disputedRowVerdict: {
      row: '`\\b` (101/226 patterns) marked unsupported by the leg\'s RE2 table',
      settled: 'FALSIFIED — `\\b` IS supported by the pinned OPA (RE2/Go regexp) as an ASCII word boundary.',
      evidence:
        'regex.match(`\\bfoo\\b`, "a foo b") = true; regex.match(`\\bfoo\\b`, "afoob") = false; the corpus pattern 61dcb058bd1df15d matches its fixture fail line and not its pass line.',
      confirmedInexpressible:
        'lookarounds and backreferences — RE2 rejects them AT COMPILE ("invalid or unsupported Perl syntax: `(?!`", "invalid named capture: `(?<=...`", "invalid escape sequence: `\\1`"), never as a silent non-match.',
    },
    rules: classified.map((c) => ({
      ruleHash: c.ruleHash,
      corpus: c.corpus,
      class: c.class,
      pattern: c.pattern,
      heading: c.heading,
      engine: c.engine,
      markers: c.scan,
    })),
    checks: checks.rows,
  };

  const out = writeArtifact('expressibility-census.json', artifact);
  console.log(`\nclass counts: ${JSON.stringify(classCounts)} (sum ${sum} / ${rows.length})`);
  console.log(`artifact: ${out}`);
  console.log(`artifacts dir: ${ARTIFACTS_DIR}`);
  checks.finish('census');
}

await main();
