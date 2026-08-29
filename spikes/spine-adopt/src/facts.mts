// ─── The fact boundary: FactBundle extraction ────────────────────────────────
//
// Spec § Data model deltas:
//
//   "`FactBundle` (JSON) — per fixture: `{file, fileText: string|null, lines[],
//    astMatches[]}` with `astMatches` in `AstGrepMatch` shape, produced by a TS
//    fact-extractor over `@ast-grep/napi`; read by the OPA arm as `input`.
//    `fileText` is the RAW file text (`null` = unreadable — the M3 fold:
//    `requires.scope: file` distinguishes null/empty/content, and `lines[]` loses
//    terminators); `lines[]` is derived from it, whole file in order (the
//    precondition that makes suppression anchor 1 derivable). Invariant: fact
//    extraction is the ONLY ast dependency on the Rego side (the fact boundary is
//    itself a deliverable finding)."
//
// And § Differential units: "each fixture block is ONE whole-file source served
// via the dispatcher's `readStrategy`; every line is an addition with
// `precedingLine = lines[i-1]`."  So a two-section `.totem/tests/*.md` fixture
// yields TWO bundles (the fail block and the pass block), each a whole file.
//
// THE ONE PLACE `lines[]` IS NOT DERIVED FROM `fileText`: the unreadable arm.
// A diff addition exists whether or not the file can be read, so that bundle
// carries `fileText: null` beside a non-empty `lines[]` — which is exactly the
// asymmetry `requires.scope: file` has to resolve.
//
// Run: node --experimental-strip-types src/facts.mts

import * as fs from 'node:fs';
import * as path from 'node:path';

import { activeRecordSet } from './lib/record-sets.mts';
import { astQueryOf, intakeRecordSet, loadCore, type CompiledSpecimen } from './lib/records.mts';
import {
  Checks,
  FACTS_DIR,
  fillManifestBundles,
  REPO_ROOT,
  sha256,
  writeArtifact,
} from './lib/spike-env.mts';
import { fixtureAbsPath } from './lib/specimens.mts';

/**
 * K4's dev flag (spec § "K4 support"): `SPIKE_SWAP_EXAMPLES=<recordId>` swaps that
 * record's inline `bad`/`good` bundles, so the scorer's K4 control — "T7 fails
 * while T8 still MATCHes" — is runnable without editing a frozen record. Unset in
 * every normal run; the swapped bundles are labelled `provenance.swapped: true` so
 * a swapped run can never be mistaken for a clean one.
 */
const SWAP_EXAMPLES_FOR = process.env.SPIKE_SWAP_EXAMPLES ?? '';

/**
 * The G8 malformed-facts control's fixture id (spec § G8). Seed-set only: it must
 * not change the 7-specimen artifacts.
 */
const MALFORMED_FACTS_FIXTURE_ID = 'm3-malformed-lines';

export interface FactBundle {
  file: string;
  fileText: string | null;
  lines: string[];
  astMatches: unknown[];
}

// G4's `seedEntry` is carried on the INDEX row rather than on the bundle FILE:
// the 24 committed bundles under `artifacts/facts/` are read byte-for-byte by the
// Rust host and the Go probe, and a field added to all of them would move
// committed evidence for a label the index already publishes.
export interface FactRecord {
  fixtureId: string;
  specimen: string;
  ruleId: string;
  engine: string;
  source: 'corpus-fixture' | 'record-examples' | 'synthetic-control';
  arm: string;
  provenance: Record<string, unknown>;
  /** The engine-native ast query these facts were extracted with, or null for a regex specimen. */
  astQuery: string | Record<string, unknown> | null;
  factBundle: FactBundle;
}

/** `lines[]` derived from `fileText`, whole file in order. Terminators are lost — that is the point. */
function linesOf(fileText: string): string[] {
  return fileText.split('\n');
}

function extOf(file: string): string {
  return path.extname(file);
}

/** A compiled rule's `requires:` clause, read without widening the whole rule to `any`. */
function requiresOf(rule: unknown): { pattern: string; scope: 'line' | 'file' } | null {
  const r = (rule as { requires?: { pattern: string; scope: 'line' | 'file' } }).requires;
  return r ?? null;
}

function requiresScopeOf(rule: unknown): 'line' | 'file' | null {
  return requiresOf(rule)?.scope ?? null;
}

/**
 * Extract `astMatches` exactly the way `rule-engine.ts:1050-1062` does: the BATCH
 * helper, over `astGrepPattern ?? astGrepYamlRule`, with every line an added line.
 * The single-query helper is run beside it purely as a cross-check that the two
 * shipped entry points agree — a divergence there would silently corrupt every
 * downstream fact.
 */
function extractAstMatches(
  core: Record<string, any>,
  checks: Checks,
  label: string,
  query: string | Record<string, unknown> | null,
  content: string,
  file: string,
  lineCount: number,
): unknown[] {
  if (query === null) return [];
  // The shipped ast path skips a file whose content is falsy (`rule-engine.ts:1039`),
  // so an empty source produces no facts on either side. Mirrored, not worked around.
  if (content === '') return [];
  const ext = extOf(file);
  const addedLineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);
  const failures: string[] = [];
  const batch = core.matchAstGrepPatternsBatch(
    content,
    ext,
    [{ rule: query, addedLineNumbers }],
    (_index: number, err: Error) => failures.push(err.message),
  );
  checks.check(
    `${label} — batch ast extraction raised no per-rule failure`,
    failures.length === 0,
    failures.join('; ') || 'clean',
  );
  const single = core.matchAstGrepPattern(content, ext, query, addedLineNumbers);
  const batched = batch[0] ?? [];
  checks.eq(
    `${label} — matchAstGrepPatternsBatch agrees with matchAstGrepPattern`,
    batched,
    single,
  );
  return batched;
}

/**
 * `<ruleId>-<specimen>-<rest>.json`.
 *
 * The `<ruleId>-<specimen>-` PREFIX is load-bearing: the Rust host's join
 * (`host/src/main.rs:787`) and the Go probe's both check it, because three
 * specimens share the pinned id and a ruleId-only join would fan one bundle across
 * all three. Every fixture id already starts with its specimen id, so this is a
 * no-op for them; the G8 control's id (`m3-malformed-lines`) deliberately does
 * not, and gets the prefix prepended rather than a relaxed join on the host side.
 */
function bundleFileName(rec: FactRecord): string {
  const stem = rec.fixtureId.startsWith(`${rec.specimen}-`)
    ? rec.fixtureId
    : `${rec.specimen}-${rec.fixtureId}`;
  return `${rec.ruleId}-${stem}.json`;
}

async function main(): Promise<void> {
  const checks = new Checks();
  const core = await loadCore();

  fs.mkdirSync(FACTS_DIR, { recursive: true });
  for (const stale of fs.readdirSync(FACTS_DIR)) {
    if (stale.endsWith('.json')) fs.rmSync(path.join(FACTS_DIR, stale));
  }

  // (G3) Only records that passed BOTH gates get bundles: a rejected record has no
  // policy, so a bundle for it would be a fixture nothing can be evaluated against.
  const intake = intakeRecordSet(core);
  const recordSet = activeRecordSet();
  const seedEntryById = new Map(intake.rows.map((r) => [r.specimen.id, r.specimen.seedEntry]));

  const records: FactRecord[] = [];
  const compiledById = new Map<string, CompiledSpecimen>();

  function emit(rec: FactRecord): void {
    const bundle = rec.factBundle;
    // The derivation invariant, asserted per bundle rather than assumed.
    if (bundle.fileText !== null && rec.source !== 'synthetic-control') {
      checks.eq(
        `${rec.fixtureId} — lines[] is derived from fileText, whole file in order`,
        bundle.lines,
        linesOf(bundle.fileText),
      );
    }
    records.push(rec);
    const out = path.join(FACTS_DIR, bundleFileName(rec));
    fs.writeFileSync(out, `${JSON.stringify(rec, null, 2)}\n`, 'utf-8');
  }

  // ── 1. the corpus fixtures named in the specimen table ──
  for (const row of intake.accepted) {
    const s = row.specimen;
    const cs = row.compiled!;
    compiledById.set(s.id, cs);
    const query = astQueryOf(cs.rule);

    if (!s.fixture) continue;
    const abs = fixtureAbsPath(s.fixture);
    // The recorded DETAIL is repo-relative with `/` separators. `abs` is a host
    // path, so writing it here would stamp the operator's worktree layout into
    // committed evidence and make the artifact differ between the Windows and
    // Linux matrix arms for the same commit — i.e. not byte-comparable.
    const rel = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
    const exists = fs.existsSync(abs);
    checks.check(`specimen ${s.id} — fixture exists: ${s.fixture.file}`, exists, rel);
    // Without this guard the readFileSync below throws ENOENT BEFORE
    // `checks.finish('facts')` writes any row, so the check that just diagnosed
    // the problem never reaches the operator — they get a raw stack trace instead.
    if (!exists) continue;
    const parsed = core.parseFixture(fs.readFileSync(abs, 'utf-8'), abs);
    checks.check(
      `specimen ${s.id} — parseFixture returned a fixture`,
      Boolean(parsed),
      s.fixture.file,
    );
    if (!parsed) continue;

    // The spec table's F/P counts are CORPUS DESCRIPTIONS. Verified as such —
    // never used as verdict counts (§ Differential units).
    checks.eq(
      `specimen ${s.id} — fixture fail-line count matches the spec table (a corpus description, NOT a verdict)`,
      parsed.failLines.length,
      s.fixture.specFailLines,
    );
    checks.eq(
      `specimen ${s.id} — fixture pass-line count matches the spec table (a corpus description, NOT a verdict)`,
      parsed.passLines.length,
      s.fixture.specPassLines,
    );
    checks.check(
      `specimen ${s.id} — the fixture's declared file is IN SCOPE for the record (dispatcher predicate)`,
      core.ruleAppliesToFile(cs.rule, parsed.filePath) === true,
      `ruleAppliesToFile(rule, '${parsed.filePath}')`,
    );

    for (const [arm, blockLines] of [
      ['fail', parsed.failLines as string[]],
      ['pass', parsed.passLines as string[]],
    ] as const) {
      // ONE whole-file source per fixture BLOCK (§ Differential units).
      const fileText = blockLines.join('\n');
      const lines = linesOf(fileText);
      const fixtureId = `${s.id}-corpus-${arm}`;
      emit({
        fixtureId,
        specimen: s.id,
        ruleId: s.ruleId,
        engine: cs.engine,
        source: 'corpus-fixture',
        arm,
        provenance: {
          fixtureFile: s.fixture.file,
          fixtureRuleHash: parsed.ruleHash,
          fixtureDeclaredFilePath: parsed.filePath,
          blockLineCount: blockLines.length,
          shaping:
            'ONE whole-file source per fixture block; every line an addition with precedingLine = lines[i-1].',
        },
        astQuery: query,
        factBundle: {
          file: parsed.filePath,
          fileText,
          lines,
          astMatches: extractAstMatches(
            core,
            checks,
            fixtureId,
            query,
            fileText,
            parsed.filePath,
            lines.length,
          ),
        },
      });
    }
  }

  // ── 2. every record's own inline `examples[]` (the exemplars' pairs included) ──
  for (const row of intake.accepted) {
    const s = row.specimen;
    const cs = compiledById.get(s.id)!;
    const query = astQueryOf(cs.rule);
    const examples = cs.record.examples as { bad: string; good: string }[];
    // K4's dev flag: this record's `bad`/`good` inline bundles are served SWAPPED.
    const swapped = SWAP_EXAMPLES_FOR !== '' && SWAP_EXAMPLES_FOR === s.id;
    checks.check(
      `specimen ${s.id} — record carries at least one example pair`,
      examples.length >= 1,
      `${examples.length} pair(s)`,
    );
    checks.check(
      `specimen ${s.id} — the inline example file path is IN SCOPE for the record`,
      core.ruleAppliesToFile(cs.rule, s.inlineFilePath) === true,
      `ruleAppliesToFile(rule, '${s.inlineFilePath}')`,
    );

    for (let i = 0; i < examples.length; i++) {
      for (const arm of ['bad', 'good'] as const) {
        const servedArm = swapped ? (arm === 'bad' ? 'good' : 'bad') : arm;
        const fileText = examples[i]![servedArm];
        const lines = linesOf(fileText);
        const fixtureId = `${s.id}-inline${examples.length > 1 ? `${i}` : ''}-${arm}`;
        emit({
          fixtureId,
          specimen: s.id,
          ruleId: s.ruleId,
          engine: cs.engine,
          source: 'record-examples',
          arm,
          provenance: {
            recordFile: path.relative(REPO_ROOT, s.recordFile).split(path.sep).join('/'),
            exampleOrdinal: i,
            examplePairHash: cs.parsed.examplePairHashes?.[i]?.hash ?? null,
            ...(swapped
              ? {
                  swapped: true,
                  swapFlag: `SPIKE_SWAP_EXAMPLES=${s.id}`,
                  servedArm,
                  note: "K4 CONTROL — this bundle carries the OTHER arm's source. The run is not a clean one; the label is the only thing that says so.",
                }
              : {}),
          },
          astQuery: query,
          factBundle: {
            file: s.inlineFilePath,
            fileText,
            lines,
            astMatches: extractAstMatches(
              core,
              checks,
              fixtureId,
              query,
              fileText,
              s.inlineFilePath,
              lines.length,
            ),
          },
        });
      }
    }
  }

  // ── 3. the M3-fold controls: the unreadable arm and the empty-file arm ──
  //
  // Both belong to the set's `requires.scope: file` record — the only arm where the
  // distinction is observable, because `requires.scope: line` never reads a file.
  // Selected by that PROPERTY rather than by the id `d-file`, so a set that has no
  // such record skips the controls with a named reason instead of crashing on a
  // missing specimen. (The seed set has none: only `5da43ea6` carries `requires`,
  // and its scope is `line`.)
  const m3Row = intake.accepted.find((r) => requiresScopeOf(r.compiled!.rule) === 'file');
  if (m3Row) {
    const dFile = m3Row.specimen;
    const dFileCompiled = m3Row.compiled!;
    const triggerLine = (dFileCompiled.record.examples as { bad: string }[])[0]!.bad;
    const requiresPattern = String(requiresOf(dFileCompiled.rule)?.pattern);

    emit({
      fixtureId: `${dFile.id}-control-unreadable`,
      specimen: dFile.id,
      ruleId: dFile.ruleId,
      engine: dFileCompiled.engine,
      source: 'synthetic-control',
      arm: 'unreadable',
      provenance: {
        mirrors: 'record-runtime.test.ts:385-394 — "fires when the file cannot be read at all"',
        note: 'fileText: null beside a NON-EMPTY lines[]. A diff addition exists whether or not the file can be read, so lines[] here comes from the DIFF, not from fileText — the one bundle where the two sources are not the same source.',
        expectation: 'context absent => fail TOWARD flagging => FIRES',
      },
      astQuery: null,
      factBundle: {
        file: 'scripts/absent.sh',
        fileText: null,
        lines: [triggerLine],
        astMatches: [],
      },
    });

    emit({
      fixtureId: `${dFile.id}-control-empty`,
      specimen: dFile.id,
      ruleId: dFile.ruleId,
      engine: dFileCompiled.engine,
      source: 'synthetic-control',
      arm: 'empty',
      provenance: {
        note: "fileText: '' — READABLE but zero-length. Distinct from null: the requirement is EVALUATED against the empty string, so the verdict depends on whether requires.pattern matches ''. The split is measured in shipped-verdicts.mts against a hand-constructed ''-matching requirement.",
        expectation: `requires.pattern '${requiresPattern}' does NOT match '' => FIRES; a ''-matching requirement (e.g. 'a*') IS satisfied => silent.`,
      },
      astQuery: null,
      factBundle: { file: 'scripts/empty.sh', fileText: '', lines: [triggerLine], astMatches: [] },
    });
  } else {
    checks.check(
      'M3 FOLD — SKIPPED with a named reason: this record set carries no `requires.scope: file` record, so the null/empty/content split is not constructible from it',
      true,
      `record set ${recordSet}; requires scopes present: ${JSON.stringify(
        [
          ...new Set(intake.accepted.map((r) => requiresScopeOf(r.compiled!.rule) ?? 'none')),
        ].sort(),
      )}`,
    );
  }

  // ── 4. (G8) the malformed-facts control, seed set ONLY ──
  //
  // ONE synthetic bundle whose `lines[]` carries a NON-STRING member, so the
  // lowered `facts_wellformed` guard is false, `result` is UNDEFINED and every host
  // must raise an ERROR ROW rather than read a zero-violation verdict. It is the
  // K5b control: the strictness contract, exercised end-to-end instead of asserted.
  //
  // GATED ON THE SEED SET because it must not change the 7-specimen artifacts
  // (§ G8, explicitly). The comparator carves it out under the named explanation
  // class `MALFORMED-FACTS-CONTROL`, so it can never render as an unexplained
  // divergence or manufacture a parity divergence.
  const k3Row = intake.accepted.find((r) => r.specimen.fixture !== null) ?? intake.accepted[0];
  if (recordSet === 'seed20' && k3Row) {
    const cs = compiledById.get(k3Row.specimen.id)!;
    const goodLine = (cs.record.examples as { bad: string }[])[0]!.bad.split('\n')[0]!;
    emit({
      fixtureId: MALFORMED_FACTS_FIXTURE_ID,
      specimen: k3Row.specimen.id,
      ruleId: k3Row.specimen.ruleId,
      engine: cs.engine,
      source: 'synthetic-control',
      arm: 'malformed',
      provenance: {
        malformedFactsControl: true,
        contract: 'spec `.totem/specs/seed20-apparatus.md` § G8 (K5b)',
        note: 'lines[] carries a NON-STRING member, so `facts_wellformed` is false and the entrypoint`s `result` is UNDEFINED. Every arm — wasmtime, regorus, wazero AND the shipped harness — must produce an ERROR ROW for this bundle, never a clean zero and never a missing row.',
        expectation:
          'error row on every arm; carved out by `src/compare.mts` under the explanation class MALFORMED-FACTS-CONTROL; counted as the ONE expected error row per arm in the run-level errorRows accounting.',
      },
      astQuery: null,
      factBundle: {
        file: k3Row.specimen.inlineFilePath,
        fileText: goodLine,
        // The second member is a NUMBER. Deliberately not a string that looks like
        // one: `is_string` is what the guard tests.
        lines: [goodLine, 42],
        astMatches: [],
      } as unknown as FactBundle,
    });
  }

  // ── the fact-boundary invariant ──
  const astBundles = records.filter((r) => r.astQuery !== null);
  const regexBundles = records.filter((r) => r.astQuery === null);
  checks.check(
    'FACT BOUNDARY — every ast fact came from the extractor; no bundle for a regex specimen carries an ast match',
    regexBundles.every((r) => r.factBundle.astMatches.length === 0),
    `${regexBundles.length} regex bundles, ${astBundles.length} ast bundles`,
  );
  checks.check(
    'FACT BOUNDARY — at least one ast bundle actually carries matches (the extractor is not vacuously clean)',
    astBundles.some((r) => r.factBundle.astMatches.length > 0),
    `${astBundles.filter((r) => r.factBundle.astMatches.length > 0).length} of ${astBundles.length} ast bundles have ≥1 match`,
  );
  if (m3Row) {
    checks.check(
      'M3 FOLD — the three fileText states are all present: null, empty, and content',
      records.some((r) => r.factBundle.fileText === null) &&
        records.some((r) => r.factBundle.fileText === '') &&
        records.some((r) => (r.factBundle.fileText ?? '').length > 0),
      `null=${records.filter((r) => r.factBundle.fileText === null).length}, empty=${records.filter((r) => r.factBundle.fileText === '').length}, content=${records.filter((r) => (r.factBundle.fileText ?? '').length > 0).length}`,
    );
  }
  const names = records.map((r) => bundleFileName(r));
  checks.eq('bundle filenames are unique', names.length, new Set(names).size);
  // The host and the probe both join on the `<ruleId>-<specimen>-` filename prefix
  // (`host/src/main.rs:787`). Asserted here, where the names are minted, so a
  // fixture id that broke the join is caught before three arms disagree about it.
  checks.eq(
    'every bundle filename carries the `<ruleId>-<specimen>-` join prefix the hosts check',
    records
      .filter((r) => !bundleFileName(r).startsWith(`${r.ruleId}-${r.specimen}-`))
      .map((r) => bundleFileName(r)),
    [],
  );
  if (SWAP_EXAMPLES_FOR !== '') {
    const swappedIds = records
      .filter((r) => (r.provenance as { swapped?: boolean }).swapped === true)
      .map((r) => r.fixtureId);
    checks.check(
      `K4 CONTROL — SPIKE_SWAP_EXAMPLES=${SWAP_EXAMPLES_FOR} swapped this record's inline arms; the run is NOT a clean one`,
      swappedIds.length > 0,
      swappedIds.length > 0
        ? swappedIds.join(', ')
        : `no record with id ${JSON.stringify(SWAP_EXAMPLES_FOR)} is in the loaded set`,
    );
  }

  const index = writeArtifact('facts-index.json', {
    generatedBy: 'spikes/spine-adopt/src/facts.mts',
    spec: '.totem/specs/spine-spike.md § Data model deltas (FactBundle) + § Differential units',
    factsDir: path.relative(REPO_ROOT, FACTS_DIR).split(path.sep).join('/'),
    bundleCount: records.length,
    bundles: records.map((r) => ({
      file: bundleFileName(r),
      fixtureId: r.fixtureId,
      specimen: r.specimen,
      seedEntry: seedEntryById.get(r.specimen) ?? null,
      ruleId: r.ruleId,
      engine: r.engine,
      source: r.source,
      arm: r.arm,
      fileTextState:
        r.factBundle.fileText === null
          ? 'null'
          : r.factBundle.fileText === ''
            ? 'empty'
            : 'content',
      lineCount: r.factBundle.lines.length,
      astMatchCount: r.factBundle.astMatches.length,
      ...((r.provenance as { malformedFactsControl?: boolean }).malformedFactsControl === true
        ? { malformedFactsControl: true }
        : {}),
    })),
    checks: checks.rows,
  });

  // (G5) the manifest's `bundles[]`, filled here — the run's identity now names the
  // exact fact bytes every arm was evaluated against.
  const manifestAt = fillManifestBundles(
    records.map((r) => ({
      fixtureId: r.fixtureId,
      sha256: sha256(fs.readFileSync(path.join(FACTS_DIR, bundleFileName(r)))),
    })),
  );

  console.log(`\n${records.length} fact bundles written to ${FACTS_DIR}`);
  console.log(`index: ${index}`);
  console.log(`manifest bundles filled: ${manifestAt}`);
  checks.finish('facts');
}

await main();
