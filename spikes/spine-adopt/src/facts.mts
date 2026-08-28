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

import { astQueryOf, compileSpecimen, loadCore, type CompiledSpecimen } from './lib/records.mts';
import { Checks, FACTS_DIR, REPO_ROOT, writeArtifact } from './lib/spike-env.mts';
import { fixtureAbsPath, SPECIMENS, type Specimen } from './lib/specimens.mts';

export interface FactBundle {
  file: string;
  fileText: string | null;
  lines: string[];
  astMatches: unknown[];
}

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

function bundleFileName(rec: FactRecord): string {
  return `${rec.ruleId}-${rec.fixtureId}.json`;
}

async function main(): Promise<void> {
  const checks = new Checks();
  const core = await loadCore();

  fs.mkdirSync(FACTS_DIR, { recursive: true });
  for (const stale of fs.readdirSync(FACTS_DIR)) {
    if (stale.endsWith('.json')) fs.rmSync(path.join(FACTS_DIR, stale));
  }

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
  for (const s of SPECIMENS) {
    const cs = compileSpecimen(core, s);
    compiledById.set(s.id, cs);
    const query = astQueryOf(cs.rule);

    if (!s.fixture) continue;
    const abs = fixtureAbsPath(s.fixture);
    checks.check(`specimen ${s.id} — fixture exists: ${s.fixture.file}`, fs.existsSync(abs), abs);
    const parsed = core.parseFixture(fs.readFileSync(abs, 'utf-8'), abs);
    checks.check(`specimen ${s.id} — parseFixture returned a fixture`, Boolean(parsed), s.fixture.file);
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
  for (const s of SPECIMENS) {
    const cs = compiledById.get(s.id)!;
    const query = astQueryOf(cs.rule);
    const examples = cs.record.examples as { bad: string; good: string }[];
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
        const fileText = examples[i]![arm];
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
  // Both belong to specimen (d)'s `scope: file` variant — the only arm where the
  // distinction is observable, because `requires.scope: line` never reads a file.
  const dFile = SPECIMENS.find((x) => x.id === 'd-file')!;
  const dFileCompiled = compiledById.get('d-file')!;
  const triggerLine = (dFileCompiled.record.examples as { bad: string }[])[0]!.bad;

  emit({
    fixtureId: 'd-file-control-unreadable',
    specimen: 'd-file',
    ruleId: dFile.ruleId,
    engine: dFileCompiled.engine,
    source: 'synthetic-control',
    arm: 'unreadable',
    provenance: {
      mirrors: 'record-runtime.test.ts:385-394 — "fires when the file cannot be read at all"',
      note:
        'fileText: null beside a NON-EMPTY lines[]. A diff addition exists whether or not the file can be read, so lines[] here comes from the DIFF, not from fileText — the one bundle where the two sources are not the same source.',
      expectation: 'context absent => fail TOWARD flagging => FIRES',
    },
    astQuery: null,
    factBundle: { file: 'scripts/absent.sh', fileText: null, lines: [triggerLine], astMatches: [] },
  });

  emit({
    fixtureId: 'd-file-control-empty',
    specimen: 'd-file',
    ruleId: dFile.ruleId,
    engine: dFileCompiled.engine,
    source: 'synthetic-control',
    arm: 'empty',
    provenance: {
      note:
        "fileText: '' — READABLE but zero-length. Distinct from null: the requirement is EVALUATED against the empty string, so the verdict depends on whether requires.pattern matches ''. The split is measured in shipped-verdicts.mts against a hand-constructed ''-matching requirement.",
      expectation:
        "requires.pattern 'LC_ALL=C' does NOT match '' => FIRES; a ''-matching requirement (e.g. 'a*') IS satisfied => silent.",
    },
    astQuery: null,
    factBundle: { file: 'scripts/empty.sh', fileText: '', lines: [triggerLine], astMatches: [] },
  });

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
  checks.check(
    'M3 FOLD — the three fileText states are all present: null, empty, and content',
    records.some((r) => r.factBundle.fileText === null) &&
      records.some((r) => r.factBundle.fileText === '') &&
      records.some((r) => (r.factBundle.fileText ?? '').length > 0),
    `null=${records.filter((r) => r.factBundle.fileText === null).length}, empty=${records.filter((r) => r.factBundle.fileText === '').length}, content=${records.filter((r) => (r.factBundle.fileText ?? '').length > 0).length}`,
  );
  const names = records.map((r) => bundleFileName(r));
  checks.eq('bundle filenames are unique', names.length, new Set(names).size);

  const index = writeArtifact('facts-index.json', {
    generatedBy: 'spikes/spine-adopt/src/facts.mts',
    spec: '.totem/specs/spine-spike.md § Data model deltas (FactBundle) + § Differential units',
    factsDir: path.relative(REPO_ROOT, FACTS_DIR).split(path.sep).join('/'),
    bundleCount: records.length,
    bundles: records.map((r) => ({
      file: bundleFileName(r),
      fixtureId: r.fixtureId,
      specimen: r.specimen,
      ruleId: r.ruleId,
      engine: r.engine,
      source: r.source,
      arm: r.arm,
      fileTextState: r.factBundle.fileText === null ? 'null' : r.factBundle.fileText === '' ? 'empty' : 'content',
      lineCount: r.factBundle.lines.length,
      astMatchCount: r.factBundle.astMatches.length,
    })),
    checks: checks.rows,
  });

  console.log(`\n${records.length} fact bundles written to ${FACTS_DIR}`);
  console.log(`index: ${index}`);
  checks.finish('facts');
}

await main();
