// ─── The record invariant: every specimen parses AND lowers, with zero deviations ──
//
// Spec § Data model deltas: "`SpikeRecord` — the 5 `.rule.yaml` sources (parsed
// with the exported `parseRuleRecord`); invariant: each parses + compiles via
// `compileRuleRecord`."
//
// § Invariants adds the strengthened form (falsification fold cluster P3): the
// language⇄glob floor and the engine-binding assert live in the LOWERING, so a
// parse-only check is not the invariant.
//
// This file also discharges the TRANSCRIPTION obligations, and it does so against
// the REFERENTS rather than by eye:
//   - specimens a/b/c/c-supp: field equality against the named legacy corpus row.
//   - specimens d/e: field equality against `record-exemplars.fixture.js` itself
//     (deliberately non-barrel-exported, so it is imported from its own dist path).
//
// Run: node --experimental-strip-types src/verify-records.mts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { compileSpecimen, loadCore, type CompiledSpecimen } from './lib/records.mts';
import { Checks, CORPORA, REPO_ROOT, writeArtifact } from './lib/spike-env.mts';
import { PINNED_NOW, recordRelPath, SPECIMENS } from './lib/specimens.mts';

const EXEMPLAR_DIST = path.join(
  REPO_ROOT,
  'packages',
  'core',
  'dist',
  'spine',
  'record-exemplars.fixture.js',
);

/**
 * The repo-relative form of `EXEMPLAR_DIST`, with POSIX separators.
 *
 * `path.join` uses the HOST separator, so the raw slice yields
 * `packages\core\dist\...` on Windows and `packages/core/dist/...` on Linux.
 * `npm run all` regenerates `records-verification.json` on BOTH matrix arms, and
 * this value is committed evidence — normalising here is what makes the two arms
 * byte-comparable for the same commit.
 */
const EXEMPLAR_REFERENT = EXEMPLAR_DIST.slice(REPO_ROOT.length + 1)
  .split(path.sep)
  .join('/');

function legacyCorpusIndex(): Map<string, any> {
  const index = new Map<string, any>();
  for (const { file } of CORPORA) {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { rules?: any[] };
    for (const r of parsed.rules ?? []) index.set(r.lessonHash, r);
  }
  return index;
}

/** Deep-equality that reports the first differing key path, so a mismatch is diagnosable. */
function firstDiff(a: unknown, b: unknown, at = '$'): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b) return `${at}: type ${typeof a} vs ${typeof b}`;
  if (a === null || b === null || typeof a !== 'object') {
    return `${at}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${at}: array-ness differs`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${at}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${at}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(ao), ...Object.keys(bo)])].sort();
  for (const k of keys) {
    if (!(k in ao)) return `${at}.${k}: missing on left`;
    if (!(k in bo)) return `${at}.${k}: missing on right`;
    const d = firstDiff(ao[k], bo[k], `${at}.${k}`);
    if (d) return d;
  }
  return null;
}

/** Every key at every depth of the authored record, for the closed-key assertion. */
function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const checks = new Checks();
  const core = await loadCore();
  const legacy = legacyCorpusIndex();

  if (!fs.existsSync(EXEMPLAR_DIST)) {
    throw new Error(
      `exemplar fixture dist missing at ${EXEMPLAR_DIST} — run \`pnpm -r build\` first.`,
    );
  }
  const exemplars = (await import(pathToFileURL(EXEMPLAR_DIST).href)) as Record<string, () => any>;
  checks.check(
    'the two exemplar factories are reachable at their non-barrel dist path',
    typeof exemplars.design4ExemplarRecord === 'function' &&
      typeof exemplars.design8ExemplarRecord === 'function',
    EXEMPLAR_REFERENT,
  );

  const compiled: CompiledSpecimen[] = [];
  const rows: any[] = [];

  for (const s of SPECIMENS) {
    // ── the invariant itself: parse, then lower ──
    let cs: CompiledSpecimen;
    try {
      cs = compileSpecimen(core, s);
      checks.check(`specimen ${s.id} — parseRuleRecord + compileRuleRecord succeed`, true, s.class);
    } catch (err) {
      checks.check(
        `specimen ${s.id} — parseRuleRecord + compileRuleRecord succeed`,
        false,
        (err as Error).message,
      );
      continue;
    }
    compiled.push(cs);

    // ── closed-key floor: no producer-owned / inexpressible key at any depth ──
    const keys = allKeys(cs.record);
    const forbidden = [...keys].filter((k) =>
      (core.RULE_RECORD_INEXPRESSIBLE_KEYS as Set<string>).has(k),
    );
    checks.check(
      `specimen ${s.id} — carries NO § Design 4 inexpressible key (no ruleId, no positiveFixtures, …)`,
      forbidden.length === 0,
      forbidden.length
        ? `found: ${forbidden.join(', ')}`
        : `${keys.size} distinct keys, all expressible`,
    );

    // ── the lowered identity IS the threaded producer id (ADR-112 §8/§9) ──
    checks.eq(
      `specimen ${s.id} — lowered lessonHash === threaded ruleId`,
      cs.rule.lessonHash,
      s.ruleId,
    );
    checks.eq(
      `specimen ${s.id} — lowered compiledAt === injected now`,
      cs.rule.compiledAt,
      PINNED_NOW,
    );

    // ── YAML hazard N8: the regex survived authoring unmangled ──
    if (cs.record.target.type === 'regex') {
      const pattern = cs.record.target.pattern as string;
      // The mangling signature to rule out is a RAW CONTROL CHARACTER: a
      // double-quoted YAML scalar resolves the word-boundary escape to U+0008 and
      // the newline escape to U+000A, so the regex would carry control bytes where
      // the two-character escape sequences belong. Backslashes present and zero
      // control bytes means the pattern survived authoring intact.
      const controlBytes = [...pattern].filter((ch) => ch.charCodeAt(0) < 0x20);
      checks.check(
        `specimen ${s.id} — target.pattern round-trips through YAML with backslashes INTACT (no control bytes)`,
        controlBytes.length === 0 && pattern.includes(String.fromCharCode(92)),
        `${JSON.stringify(pattern)}${controlBytes.length ? ` — control bytes: ${controlBytes.map((c) => `U+${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join(',')}` : ''}`,
      );
      checks.check(
        `specimen ${s.id} — the authored YAML uses a single-quoted/block scalar for the pattern (never double-quoted)`,
        !new RegExp(`pattern:\\s*"`).test(cs.yamlText),
        'no `pattern: "` occurrence in the source',
      );
    }

    // ── transcription fidelity, against the referent ──
    const legacyRule = s.legacySource ? legacy.get(s.legacySource) : null;
    if (s.legacySource) {
      checks.check(
        `specimen ${s.id} — the named legacy source ${s.legacySource} exists in the corpora`,
        Boolean(legacyRule),
        legacyRule ? (legacyRule.lessonHeading ?? '') : 'NOT FOUND',
      );
    }
    if (legacyRule) {
      checks.eq(
        `specimen ${s.id} — severity carried from the legacy rule`,
        cs.record.severity,
        legacyRule.severity,
      );
      checks.eq(
        `specimen ${s.id} — message carried VERBATIM from the legacy rule`,
        cs.record.message,
        legacyRule.message,
      );

      // The legacy glob list, split into the record grammar's two arrays.
      const legacyPositives = (legacyRule.fileGlobs ?? []).filter(
        (g: string) => !g.startsWith('!'),
      );
      const legacyNegatives = (legacyRule.fileGlobs ?? [])
        .filter((g: string) => g.startsWith('!'))
        .map((g: string) => g.slice(1));
      const excl = cs.record.target.scope.excludeGlobs ?? [];
      checks.eq(
        `specimen ${s.id} — every legacy \`!\`-negation became a POSITIVE-FORM excludeGlobs entry`,
        [...excl].sort(),
        [...legacyNegatives].sort(),
      );
      checks.check(
        `specimen ${s.id} — no excludeGlobs entry carries a \`!\` prefix (record grammar, § Design 4)`,
        excl.every((g: string) => !g.startsWith('!')),
        JSON.stringify(excl),
      );

      if (s.id === 'a') {
        checks.eq(
          'specimen a — all 9 legacy POSITIVE globs carried verbatim, in order',
          cs.record.target.scope.fileGlobs,
          legacyPositives,
        );
        checks.eq(
          'specimen a — target.pattern identical to the legacy rule pattern',
          cs.record.target.pattern,
          legacyRule.pattern,
        );
      }
      if (s.id === 'b') {
        // The spec's M1 narrowing — asserted as a DELIBERATE divergence, not a silent one.
        checks.eq(
          "specimen b — fileGlobs NARROWED to ['**/*.ts'] (the legacy 4-extension set is a § Design 6 floor violation)",
          cs.record.target.scope.fileGlobs,
          ['**/*.ts'],
        );
        checks.eq(
          'specimen b — language declared typescript',
          cs.record.target.language,
          'typescript',
        );
        checks.eq(
          'specimen b — ast-grep pattern identical to the legacy rule',
          cs.record.target.pattern,
          legacyRule.astGrepPattern,
        );
        // Scope is checked with the dispatcher's OWN predicate (`rule-engine.ts:1014`
        // calls `ruleAppliesToFile`), not a raw glob helper — the narrowing only
        // matters if the fixture file still reaches the rule at dispatch.
        checks.check(
          'specimen b — the fixture file scripts/audit.ts is still IN SCOPE under the narrowed glob (dispatcher predicate)',
          core.ruleAppliesToFile(cs.rule, 'scripts/audit.ts') === true,
          `ruleAppliesToFile(rule, 'scripts/audit.ts') = ${core.ruleAppliesToFile(cs.rule, 'scripts/audit.ts')}`,
        );
        // The floor the narrowing exists to satisfy, EXECUTED rather than cited:
        // re-author specimen b with the legacy 4-extension glob set and confirm
        // `compileRuleRecord` REJECTS it. `checkLanguageGlobConsistency` is not on
        // the barrel, so this exercises the real lowering path instead — stronger
        // evidence, and it needs no import outside the P5 seam.
        const unnarrowedYaml = cs.yamlText.replace(
          /    fileGlobs:\n      - '\*\*\/\*\.ts'\n/,
          // FUNCTION replacer — `$`-bearing replacement text is otherwise treated
          // as a substitution directive.
          () =>
            `    fileGlobs:\n${legacyPositives.map((g: string) => `      - '${g}'`).join('\n')}\n`,
        );
        checks.check(
          'specimen b — the un-narrowed control YAML really did substitute the 4 legacy globs',
          unnarrowedYaml !== cs.yamlText &&
            legacyPositives.every((g: string) => unnarrowedYaml.includes(`- '${g}'`)),
          `${legacyPositives.length} globs: ${legacyPositives.join(', ')}`,
        );
        const unnarrowedOutcome = core.compileRuleRecord(
          core.parseRuleRecord(
            unnarrowedYaml,
            'spikes/spine-adopt/records/CONTROL-b-unnarrowed.rule.yaml',
          ),
          { ruleId: s.ruleId, now: PINNED_NOW },
        );
        checks.check(
          'specimen b — the LEGACY 4-extension glob set is LOWERING-REJECTED (§ Design 6 one-declared-language floor), EXECUTED',
          unnarrowedOutcome.kind === 'rejected',
          unnarrowedOutcome.kind === 'rejected'
            ? unnarrowedOutcome.reason
            : '(it COMPILED — the narrowing would be unmotivated)',
        );
      }
      if (s.id === 'c' || s.id === 'c-supp') {
        checks.eq(
          `specimen ${s.id} — compound rule tree identical to the legacy astGrepYamlRule.rule`,
          cs.record.target.rule,
          legacyRule.astGrepYamlRule.rule,
        );
        // MEASURED record-vs-legacy divergence in the lowered NapiConfig: the
        // record path PINS the grammar (`language`) from the record's declared
        // `target.language`, which the legacy config never carries. The rule TREE
        // is byte-identical; the config gains exactly one key. Asserted as a
        // one-key delta so a future drift cannot hide inside "close enough".
        checks.eq(
          `specimen ${s.id} — the lowered NapiConfig carries the SAME rule tree`,
          cs.rule.astGrepYamlRule.rule,
          legacyRule.astGrepYamlRule.rule,
        );
        checks.eq(
          `specimen ${s.id} — the lowered NapiConfig adds EXACTLY the pinned grammar key (record-vs-legacy delta)`,
          Object.keys(cs.rule.astGrepYamlRule).sort(),
          ['language', 'rule'],
        );
        checks.check(
          `specimen ${s.id} — the pinned grammar resolves from the record's declared language`,
          typeof cs.rule.astGrepYamlRule.language === 'string' &&
            cs.rule.astGrepYamlRule.language.toLowerCase() === cs.record.target.language,
          `astGrepYamlRule.language = ${JSON.stringify(cs.rule.astGrepYamlRule.language)} for target.language = ${JSON.stringify(cs.record.target.language)}`,
        );
        checks.check(
          `specimen ${s.id} — the LEGACY config carries no such pin (the divergence is on the legacy side)`,
          legacyRule.astGrepYamlRule.language === undefined,
          `legacy keys: ${Object.keys(legacyRule.astGrepYamlRule).join(', ')}`,
        );
      }
      if (s.id === 'c') {
        // The dual-dialect hazard, asserted as PRESENT rather than described.
        const embedded = JSON.stringify(cs.record.target.rule).includes('"regex":"^shell$"');
        checks.check(
          'specimen c — the embedded Rust-regex-crate expression `^shell$` survives into the lowered tree',
          embedded,
          'target.rule contains regex:"^shell$"',
        );
        const kinds = JSON.stringify(cs.record.target.rule);
        checks.check(
          'specimen c — `kind: true` stayed a STRING through YAML (bare `true` would be a boolean)',
          kinds.includes('"kind":"true"') && !kinds.includes('"kind":true'),
          'target.rule carries kind:"true"',
        );
      }
    }

    // ── exemplar transcriptions: equality against the fixture module ──
    if (s.exemplarFactory) {
      const source = exemplars[s.exemplarFactory]!();
      const expected =
        s.id === 'd-file'
          ? { ...source, requires: { pattern: 'LC_ALL=C', scope: 'file' } }
          : source;
      const diff = firstDiff(cs.record, expected);
      checks.check(
        `specimen ${s.id} — transcription is FIELD-IDENTICAL to ${s.exemplarFactory}()${s.id === 'd-file' ? ' with the pinned {scope: file} spread (record-runtime.test.ts:358-361)' : ''}`,
        diff === null,
        diff ?? 'exact',
      );
    }

    rows.push({
      specimen: s.id,
      class: s.class,
      recordFile: recordRelPath(s),
      ruleId: s.ruleId,
      legacySource: s.legacySource,
      exemplarFactory: s.exemplarFactory,
      loweredEngine: cs.engine,
      loweredFileGlobs: cs.rule.fileGlobs ?? null,
      recordFileGlobs: cs.record.target.scope.fileGlobs,
      recordExcludeGlobs: cs.record.target.scope.excludeGlobs ?? null,
      requires: cs.record.requires ?? null,
      hasVerificationShadow: Boolean(cs.record.verification_shadow),
      hasCuration: Boolean(cs.record.curation),
      examples: cs.record.examples,
      distinctKeysAtEveryDepth: [...allKeys(cs.record)].sort(),
    });
  }

  checks.eq('all 7 record sources compiled', compiled.length, SPECIMENS.length);

  // ── the hand-constructed empty-positives control (§ Invariants) ──
  // "excludeGlobs uses the record profile — empty-positives ⇒ match-nothing is a
  //  HAND-CONSTRUCTED control (unreachable from a parsed record: `fileGlobs` is
  //  min-1 at parse)." Both halves are asserted: the parser really does refuse,
  //  and the runtime predicate really does match nothing.
  let parserRefused = false;
  let refusalDetail = '';
  try {
    core.parseRuleRecord(
      [
        'schemaVersion: 1',
        'severity: error',
        'message: empty-positives control',
        'target:',
        '  type: regex',
        "  pattern: 'x'",
        '  scope:',
        '    fileGlobs: []',
        'examples:',
        '  - bad: x',
        '    good: y',
        '',
      ].join('\n'),
      'spikes/spine-adopt/records/CONTROL-empty-positives.rule.yaml',
    );
  } catch (err) {
    parserRefused = true;
    refusalDetail = (err as Error).message.slice(0, 180);
  }
  checks.check(
    'CONTROL — an empty `fileGlobs` is UNREACHABLE from a parsed record (min-1 at parse)',
    parserRefused,
    refusalDetail || 'parser ACCEPTED an empty fileGlobs — the control premise is wrong',
  );

  // The hand-constructed half: the record profile's own predicate, called with an
  // empty positives list, against paths a legacy rule would match.
  const probePaths = ['a.ts', 'packages/core/src/a.ts', 'scripts/x.sh'];
  const recordProfile = probePaths.map((p) => core.recordScopeMatchesFile(p, [], ['**/never.ts']));
  const legacyProfile = probePaths.map((p) => core.fileMatchesGlobs(p, []));
  checks.check(
    'CONTROL — hand-constructed empty-positives RECORD scope matches NOTHING',
    recordProfile.every((m: boolean) => m === false),
    probePaths.map((p, i) => `${p}=${recordProfile[i]}`).join(', '),
  );
  checks.check(
    'CONTROL — the LEGACY profile on the same empty list matches EVERYTHING (the documented inversion)',
    legacyProfile.every((m: boolean) => m === true),
    probePaths.map((p, i) => `${p}=${legacyProfile[i]}`).join(', '),
  );
  checks.check(
    'CONTROL — the two profiles are opposites on every probe path',
    probePaths.every((_, i) => recordProfile[i] !== legacyProfile[i]),
    `${probePaths.length} paths`,
  );

  const out = writeArtifact('records-verification.json', {
    generatedBy: 'spikes/spine-adopt/src/verify-records.mts',
    spec: '.totem/specs/spine-spike.md § Data model deltas (SpikeRecord) + § Invariants',
    exemplarReferent: EXEMPLAR_REFERENT,
    pinnedRuleId: SPECIMENS.find((s) => s.exemplarFactory)?.ruleId ?? null,
    pinnedNow: PINNED_NOW,
    specimens: rows,
    checks: checks.rows,
  });
  console.log(`\nartifact: ${out}`);
  checks.finish('verify-records');
}

await main();
