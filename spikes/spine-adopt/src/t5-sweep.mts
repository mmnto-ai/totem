// ─── T5 — the scope sweep, LOWERED vs SHIPPED, over the record-pin tree ──────
//
// Spec `.totem/specs/seed20-apparatus-slice2.md` § S6. T5 asks one question per
// (record, path): does the LOWERED policy's `in_scope` agree with the SHIPPED
// `ruleAppliesToFile`? The corpus is the tree at the RECORD PIN — the repository
// the seed records were written against — not the tree this run happens to sit on.
// The same question is asked a second time over the frozen probe set
// (`manifest.probePaths`), deposited as `probeRows[]` in the same shape.
//
// THE MEASUREMENT IS DEPOSITED, NEVER REFUSED (strategy-claude 2026-08-29T19:57Z,
// governing the charter's § 3 T5): a disagreement is that RECORD's `scope-divergence`
// — a typed miss the scorer assigns per package — not an apparatus fault. Every
// disagreement is listed in full, and the count is a named check row that reads
// true so the number is visible in the artifact. The apparatus refuses ONLY on
// apparatus fault: an `opa eval` non-zero exit, a lowered package with no sweep
// entry, or a malformed set (a member that is not a corpus path).
//
// Two readings, deliberately:
//
//   BATCHED   one `opa eval` per package, over a set comprehension that re-binds
//             `input` per path (`rego/t5-sweep.rego.tmpl`). 2,742 paths in one
//             process start.
//   PER-PATH  the same query with `-i {"file": p}` on a sample of 8 paths per
//             package — 4 in scope, 4 out. The batched form is a rewriting of the
//             per-path form, so the rewriting is checked rather than assumed.
//
// Run: node --experimental-strip-types src/t5-sweep.mts   (after src/lower.mts)

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { opa } from './lib/opa.mts';
import { activeRecordSet } from './lib/record-sets.mts';
import { intakeRecordSet, loadCore } from './lib/records.mts';
import {
  ARTIFACTS_DIR,
  Checks,
  LOWERED_PUBLISH_DIR,
  readRunManifest,
  REGO_BUILD_DIR,
  REGO_DIR,
  sha256,
  SPIKE_ROOT,
  TRACKED_PATHS_AT_RECORD_PIN_ARTIFACT,
  writeArtifact,
} from './lib/spike-env.mts';

const TEMPLATE_FILE = path.join(REGO_DIR, 't5-sweep.rego.tmpl');

/**
 * The exact argv this stage runs, with the per-package holes named.
 *
 * (fold 2 H8, `.totem/specs/seed20-apparatus-slice2-fold2.md`) The POLICY path carries
 * the `<subdir>` hole too. It always did in fact — `LOWERED_PUBLISH_DIR` derives from
 * `ARTIFACTS_DIR`, which is subdir-aware (C10) — but the published template named
 * `artifacts/lowered/…`, so a reader reproducing a K4 or control-only sweep would have
 * pointed `opa eval` at the run of record's policies while believing they were the
 * subdir'd ones. The empty-subdir convention is the same on both holes and is stated
 * in the deposit's `contract`.
 */
const INVOCATION =
  '<OPA_BIN> eval --format=json --strict-builtin-errors ' +
  '-d artifacts/<subdir>/lowered/<pkg>/policy.rego -d rego/build/<subdir>/<pkg>/t5-sweep.rego ' +
  '-i <input.json> data.t5sweep.in_scope_paths';

/**
 * (fold 2 H8) What an EMPTY `<subdir>` means in the two paths above, stated once and
 * carried into the deposit's `contract` on both arms.
 */
const SUBDIR_HOLE_NOTE =
  'In `invocation`/`argv`, `<subdir>` is `manifest.artifactsSubdir`; when it is null the segment is ELIDED, not empty — `artifacts/lowered/<pkg>/policy.rego` and `rego/build/<pkg>/t5-sweep.rego`.';

/**
 * (fold 1 F6) The same invocation as an ARGV ARRAY, holes and all — emitted BESIDE
 * `invocation`, never instead of it (the 19:57Z mail accepted the string form).
 *
 * A reader reproducing the sweep has to re-tokenise the string; the array is the
 * thing the stage actually spawns, so there is nothing to re-tokenise and no
 * quoting convention to guess at.
 */
const INVOCATION_ARGV: readonly string[] = [
  '<OPA_BIN>',
  'eval',
  '--format=json',
  '--strict-builtin-errors',
  '-d',
  'artifacts/<subdir>/lowered/<pkg>/policy.rego',
  '-d',
  'rego/build/<subdir>/<pkg>/t5-sweep.rego',
  '-i',
  '<input.json>',
  'data.t5sweep.in_scope_paths',
];

interface LoweringRow {
  specimen: string;
  seedEntry: string | null;
  control: boolean;
  package: string;
}

/**
 * (fold 1 F8) A deposited row is EXACTLY these four keys.
 *
 * No timing: `rows[]` and `probeRows[]` have to be byte-identical between the
 * scorer's evidence clone and its replay clone, and a wall-clock number makes that
 * impossible by construction. The timings are published at the top level, where they
 * are provenance rather than measurement.
 */
interface SweepRow {
  pkg: string;
  inScope: string[];
  shippedApplies: string[];
  disagreements: { path: string; in_scope: boolean; ruleAppliesToFile: boolean }[];
}

function spikeRel(abs: string): string {
  return path.relative(SPIKE_ROOT, abs).split(path.sep).join('/');
}

/** One `opa eval`, with a non-zero exit raised as the apparatus fault it is. */
function evalQuery(args: string[], label: string): unknown {
  const r = opa(args, SPIKE_ROOT);
  if (r.status !== 0) {
    throw new Error(
      `\`opa eval\` FAILED for ${label} (exit ${String(r.status)}): ${(r.stderr || r.stdout).slice(0, 1500)}`,
    );
  }
  const parsed = JSON.parse(r.stdout) as {
    result?: { expressions?: { value?: unknown }[] }[];
  };
  const expr = parsed.result?.[0]?.expressions?.[0];
  // An UNDEFINED query returns `{}` with no `result` key. That is the honest
  // answer for the per-path form on an out-of-scope path, so it is `undefined`
  // here and the caller decides what it means — never coerced to false.
  return expr === undefined ? undefined : expr.value;
}

interface CorpusSweep {
  /** `rows` (the record-pin tree) or `probeRows` (the frozen probe set). */
  label: string;
  /** The corpus, in the order the manifest lists it. */
  paths: string[];
  /** Where the corpus JSON lives for `opa eval -i`. */
  inputAt: string;
}

/**
 * Sweep ONE lowered package over ONE corpus: the batched `opa eval`, the shipped
 * reading of the same paths, the disagreement list (deposited, never refused),
 * and the per-path cross-check of the batched rewriting.
 */
function sweepPackage(
  checks: Checks,
  core: { ruleAppliesToFile(rule: unknown, filePath: string): boolean },
  compiledRule: unknown,
  row: LoweringRow,
  suffix: string,
  policyAt: string,
  wrapperAt: string,
  corpus: CorpusSweep,
  singleInputAt: string,
): { row: SweepRow; elapsedMs: number } {
  const argv = [
    'eval',
    '--format=json',
    '--strict-builtin-errors',
    '-d',
    spikeRel(policyAt),
    '-d',
    spikeRel(wrapperAt),
    '-i',
    corpus.inputAt,
    'data.t5sweep.in_scope_paths',
  ];
  const started = Date.now();
  const value = evalQuery(argv, `${suffix} (${corpus.label}, batched)`);
  const elapsedMs = Date.now() - started;

  // ── apparatus-fault arm: the set must be a set of CORPUS paths ──
  const corpusSet = new Set(corpus.paths);
  // `in_scope_paths` is a COMPLETE set-comprehension rule: an empty scope is `[]`,
  // never undefined. An undefined or non-array result therefore means the query did
  // not evaluate — an apparatus fault, named — and must never be read as "nothing in
  // scope" (mmnto-ai/totem#2699 review round 1, CodeRabbit MAJOR).
  if (!Array.isArray(value)) {
    throw new Error(
      `T5 — ${suffix} (${corpus.label}): \`in_scope_paths\` did not evaluate to a set (got ${value === undefined ? 'undefined' : typeof value}) — apparatus fault, not an empty scope`,
    );
  }
  const raw = value as unknown[];
  const malformed = raw.filter((m) => typeof m !== 'string' || !corpusSet.has(m));
  if (malformed.length > 0) {
    throw new Error(
      `T5 — ${suffix} (${corpus.label}): \`in_scope_paths\` carries ${malformed.length} member(s) that are not corpus paths (apparatus fault): ${JSON.stringify(malformed.slice(0, 5))}`,
    );
  }
  const inScope = [...new Set(raw as string[])].sort();

  // ── the SHIPPED reading of the same corpus ──
  const shippedApplies = corpus.paths
    .filter((p) => core.ruleAppliesToFile(compiledRule, p) === true)
    .sort();

  const inScopeSet = new Set(inScope);
  const shippedSet = new Set(shippedApplies);
  const disagreements = corpus.paths
    .filter((p) => inScopeSet.has(p) !== shippedSet.has(p))
    .map((p) => ({ path: p, in_scope: inScopeSet.has(p), ruleAppliesToFile: shippedSet.has(p) }));

  // DEPOSITED, never refused: the row reads true so the run continues; the
  // count and the first entries are the check's detail so a reader sees them
  // without opening the deposit. The scorer types each entry as T5
  // `scope-divergence` for this package's record.
  checks.check(
    `T5 — ${suffix} (${corpus.label}): LOWERED \`in_scope\` vs SHIPPED \`ruleAppliesToFile\` over ${corpus.paths.length} paths — ${disagreements.length} disagreement(s) DEPOSITED (a disagreement is this record's scope-divergence, typed by the scorer; never an apparatus refusal)`,
    true,
    disagreements.length === 0 ? 'no disagreement' : JSON.stringify(disagreements.slice(0, 5)),
  );

  // ── the batched form, cross-checked against the PER-PATH form ──
  const sample = [
    ...inScope.slice(0, 4),
    ...corpus.paths.filter((p) => !inScopeSet.has(p)).slice(0, 4),
  ];
  const perPath: { path: string; batched: boolean; single: boolean }[] = [];
  for (const p of sample) {
    fs.writeFileSync(singleInputAt, `${JSON.stringify({ file: p })}\n`, 'utf-8');
    const single = evalQuery(
      [
        'eval',
        '--format=json',
        '--strict-builtin-errors',
        '-d',
        spikeRel(policyAt),
        '-i',
        singleInputAt,
        `data.${row.package}.in_scope`,
      ],
      `${suffix} (${corpus.label}, per-path ${p})`,
    );
    perPath.push({ path: p, batched: inScopeSet.has(p), single: single === true });
  }
  const inSampled = Math.min(4, inScope.length);
  checks.eq(
    `T5 — ${suffix} (${corpus.label}): the BATCHED set comprehension agrees with the PER-PATH \`in_scope\` query on ${sample.length} sampled paths (${inSampled} in scope, ${sample.length - inSampled} out)`,
    perPath.filter((r) => r.batched !== r.single),
    [],
  );

  return { row: { pkg: row.package, inScope, shippedApplies, disagreements }, elapsedMs };
}

async function main(): Promise<void> {
  const checks = new Checks();
  const recordSet = activeRecordSet();
  const manifest = readRunManifest();

  const pinHeader = manifest.trackedPathsAtRecordPin as {
    pin: string;
    present: boolean;
    count: number;
    sha256: string | null;
    file: string;
  };
  if (pinHeader === undefined || (pinHeader as unknown) === null || typeof pinHeader !== 'object') {
    throw new Error(
      'the run manifest carries no `trackedPathsAtRecordPin` — re-run `npm run manifest` (it enumerates the sweep corpus).',
    );
  }
  const probePaths = manifest.probePaths as string[] | undefined;
  if (!Array.isArray(probePaths)) {
    throw new Error(
      'the run manifest carries no `probePaths[]` — re-run `npm run manifest` (it enumerates the probe set).',
    );
  }

  const templateText = fs.readFileSync(TEMPLATE_FILE, 'utf-8');
  const wrapperTemplateSha256 = sha256(templateText);

  // ── the SKIPPED arm: the record pin is not in this clone ──
  //
  // A shallow checkout has no `r14/seed-20-translation` history, so the sweep set
  // does not exist. Publishing an empty sweep would read as "no disagreements";
  // saying SKIPPED, with the reason, is the only honest thing — and the scorer
  // refuses a SKIPPED sweep on the run of record.
  if (!pinHeader.present) {
    checks.check(
      `T5 — SKIPPED with the named reason \`pin-commit-not-present-locally\`: ${pinHeader.pin} is not in this clone, so the sweep corpus could not be enumerated`,
      true,
      'run in a full clone of mmnto-ai/totem with the `r14/seed-20-translation` history fetched',
    );
    const skipped = writeArtifact('t5-sweep.json', {
      generatedBy: 'spikes/spine-adopt/src/t5-sweep.mts',
      contract: `spec \`.totem/specs/seed20-apparatus-slice2.md\` § S6 — T5 scope sweep. NOT MEASURED in this run. ${SUBDIR_HOLE_NOTE}`,
      status: 'SKIPPED — record pin commit not present locally',
      // (fold 1 F17) The SKIPPED arm carries the SAME header and timings keys as the
      // MEASURED one, empty. A consumer that reads `header.policies` or `timings`
      // must not have to branch on `status` to avoid an undefined.
      header: {
        recordPin: pinHeader.pin,
        treeCount: 0,
        treeSha256: null,
        probeCount: probePaths.length,
        invocation: INVOCATION,
        argv: INVOCATION_ARGV,
        mode: 'batched-set-comprehension',
        opaVersion: null,
        wrapperTemplateSha256,
        packages: [],
        policies: {},
        controlPackagesSkipped: [],
      },
      // (fold 2 H7) `recordSet` and `elapsedMs` mirror the MEASURED arm, in the same
      // position. Fold 1 F17 mirrored `header` and `timings` and stopped one key
      // short of the two top-level ones — so a consumer keying a sweep by record set
      // (the staleness question every other artifact answers) read `undefined` on a
      // SKIPPED deposit and could not tell it apart from a sweep of another corpus.
      recordSet,
      elapsedMs: 0,
      timings: { totalMs: 0, perPackage: {} },
      rows: [],
      probeRows: [],
      checks: checks.rows,
    });
    console.log(`\nT5 sweep SKIPPED -> ${skipped}`);
    checks.finish('t5-sweep');
    return;
  }

  // ── the sweep corpus, read BACK from the published list ──
  //
  // The manifest wrote it; this stage re-reads the file and re-checks its digest,
  // so the paths actually swept are the paths the manifest attests rather than a
  // second enumeration that could have drifted.
  const listAt = path.join(ARTIFACTS_DIR, TRACKED_PATHS_AT_RECORD_PIN_ARTIFACT);
  if (!fs.existsSync(listAt)) {
    throw new Error(
      `${listAt} is missing, but the manifest says the record pin IS present — re-run \`npm run manifest\`.`,
    );
  }
  const listText = fs.readFileSync(listAt, 'utf-8');
  // (fold 2 H1) The published list has NO trailing newline, so `split('\n')` yields
  // exactly the paths and NOTHING is dropped. The filter that used to sit here would
  // now hide the very drift this re-read exists to catch: a re-appearing trailing
  // newline would be silently trimmed and the count check would still pass while
  // `treeSha256` — the file's bytes — moved. The count check below is the guard.
  const paths = listText.split('\n');
  checks.eq(
    `T5 — the sweep corpus read back from \`artifacts/${TRACKED_PATHS_AT_RECORD_PIN_ARTIFACT}\` is the one the manifest attests (${pinHeader.count} paths)`,
    { count: paths.length, sha256: sha256(listText) },
    { count: pinHeader.count, sha256: pinHeader.sha256 },
  );

  const opaVersion =
    opa(['version'], SPIKE_ROOT)
      .stdout.split('\n')[0]
      ?.replace(/^Version:\s*/, '')
      .trim() ?? null;

  // ── the lowered packages, and the SHIPPED rule behind each ──
  const loweringAt = path.join(ARTIFACTS_DIR, 'lowering-rejects.json');
  if (!fs.existsSync(loweringAt)) {
    throw new Error(`${loweringAt} is missing — run \`npm run lower\` first.`);
  }
  let lowering: { lowered: LoweringRow[] };
  try {
    lowering = JSON.parse(fs.readFileSync(loweringAt, 'utf-8')) as { lowered: LoweringRow[] };
  } catch (err) {
    // (mmnto-ai/totem#2699 review round 1, GCA) name the artifact, not just the byte.
    throw new Error(`[Totem Error] Failed to parse the lowering index at ${loweringAt}`, {
      cause: err,
    });
  }

  const core = await loadCore();
  const intake = intakeRecordSet(core);
  const compiledById = new Map(intake.accepted.map((r) => [r.specimen.id, r.compiled!]));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-t5-'));
  const treeCorpus: CorpusSweep = {
    label: 'rows',
    paths,
    inputAt: path.join(tmp, 'sweep-input.json'),
  };
  fs.writeFileSync(treeCorpus.inputAt, `${JSON.stringify({ paths })}\n`, 'utf-8');
  const probeCorpus: CorpusSweep = {
    label: 'probeRows',
    paths: probePaths,
    inputAt: path.join(tmp, 'probe-input.json'),
  };
  fs.writeFileSync(probeCorpus.inputAt, `${JSON.stringify({ paths: probePaths })}\n`, 'utf-8');
  // `opa eval -i` takes a FILE, never inline JSON, so the per-path cross-check
  // rewrites this one rather than trying to pass a document on the command line.
  const singleInputAt = path.join(tmp, 'single-input.json');

  const headerPackages: Record<string, unknown>[] = [];
  const headerPolicies: Record<string, unknown> = {};
  const rows: SweepRow[] = [];
  const probeRows: SweepRow[] = [];
  const perPackageTimings: Record<string, { rowsMs: number; probeRowsMs: number }> = {};
  // (fold 1 F7) The K-control packages, named rather than silently absent.
  const controlPackagesSkipped: string[] = [];
  const startedAll = Date.now();

  for (const row of lowering.lowered) {
    const suffix = row.package.replace(/^totem\.spike\./, '');
    const policyAt = path.join(LOWERED_PUBLISH_DIR, suffix, 'policy.rego');
    if (!fs.existsSync(policyAt)) {
      throw new Error(
        `${policyAt} is missing — the lowering publishes it (G7); re-run \`npm run lower\`.`,
      );
    }
    const wrapperDir = path.join(REGO_BUILD_DIR, suffix);
    fs.mkdirSync(wrapperDir, { recursive: true });
    const wrapperAt = path.join(wrapperDir, 't5-sweep.rego');
    const wrapperText = templateText.split('__PACKAGE__').join(row.package);
    fs.writeFileSync(wrapperAt, wrapperText, 'utf-8');

    const compiled = compiledById.get(row.specimen);
    if (!compiled) {
      throw new Error(
        `no compiled rule for lowered record '${row.specimen}' — the lowering artifact and the loaded record set disagree; re-run \`npm run lower\`.`,
      );
    }

    // (fold 1 F7 + the E24 slice) A K-CONTROL package is not swept — and not
    // LISTED. T5 is a per-record conjunct over the SCORED records; the K5 control
    // is not one of them and is exercised by K5, in its own row. Sweeping it would
    // put a control's entry in a deposit the scorer reads as the scored corpus — and
    // § 7 E5 fixes the HEADER at the scored set too ("the records that reach target
    // lowering — 20 on this seed"): the first execution's T5 ×2 refusal class was
    // this package listed in `packages[]`/`policies` beside its own skip entry.
    // Named in `controlPackagesSkipped` ONLY — never silently dropped, never
    // double-listed.
    if (row.control === true) {
      controlPackagesSkipped.push(row.package);
      continue;
    }

    const policyRegoSha256 = sha256(fs.readFileSync(policyAt));
    const wrapperSha256 = sha256(wrapperText);
    headerPackages.push({
      pkg: row.package,
      recordId: row.specimen,
      seedEntry: row.seedEntry ?? null,
      control: row.control === true,
      policyRegoSha256,
      wrapperSha256,
    });
    // (fold 1 F6) The same identities keyed BY PACKAGE, so a reader holding a `pkg`
    // from a row does not have to scan `packages[]` to learn which policy bytes and
    // which wrapper that row was measured against. Emitted beside `packages[]`.
    headerPolicies[row.package] = {
      policyRegoSha256,
      wrapperSha256,
      recordId: row.specimen,
      seedEntry: row.seedEntry ?? null,
      control: row.control === true,
    };

    const treeSweep = sweepPackage(
      checks,
      core,
      compiled.rule,
      row,
      suffix,
      policyAt,
      wrapperAt,
      treeCorpus,
      singleInputAt,
    );
    const probeSweep = sweepPackage(
      checks,
      core,
      compiled.rule,
      row,
      suffix,
      policyAt,
      wrapperAt,
      probeCorpus,
      singleInputAt,
    );
    rows.push(treeSweep.row);
    probeRows.push(probeSweep.row);
    perPackageTimings[row.package] = {
      rowsMs: treeSweep.elapsedMs,
      probeRowsMs: probeSweep.elapsedMs,
    };
  }

  // ── apparatus-fault arm: every SCORED lowered package has exactly one entry per corpus ──
  const scoredCount = lowering.lowered.filter((l) => l.control !== true).length;
  checks.eq(
    `T5 — every NON-CONTROL lowered package has exactly one \`rows[]\` entry and one \`probeRows[]\` entry (${scoredCount} scored of ${lowering.lowered.length} lowered; ${controlPackagesSkipped.length} control package(s) skipped)`,
    { rows: rows.length, probeRows: probeRows.length },
    { rows: scoredCount, probeRows: scoredCount },
  );

  const totalMs = Date.now() - startedAll;
  const disagreeing = (list: SweepRow[]): number =>
    list.filter((p) => p.disagreements.length > 0).length;

  const out = writeArtifact('t5-sweep.json', {
    generatedBy: 'spikes/spine-adopt/src/t5-sweep.mts',
    contract:
      "spec `.totem/specs/seed20-apparatus-slice2.md` § S6 — T5 scope sweep. The charter names a per-path pair {in_scope, ruleAppliesToFile}; it is DERIVED from the two sorted lists per package (`in_scope` = path ∈ `inScope`, `ruleAppliesToFile` = path ∈ `shippedApplies`), so the deposit is O(in-scope) rather than O(tree) per package and loses nothing. `rows[]` sweeps the record-pin tree; `probeRows[]` sweeps `manifest.probePaths[]` in the same shape. Every disagreement is listed in full and DEPOSITED, never refused — the scorer types each as that record's T5 scope-divergence. The apparatus refuses only on apparatus fault (an `opa eval` non-zero exit, a lowered package with no entry, a malformed set). " +
      SUBDIR_HOLE_NOTE,
    status: 'MEASURED',
    header: {
      recordPin: pinHeader.pin,
      treeCount: paths.length,
      treeSha256: sha256(listText),
      probeCount: probePaths.length,
      invocation: INVOCATION,
      argv: INVOCATION_ARGV,
      mode: 'batched-set-comprehension',
      opaVersion,
      wrapperTemplateSha256,
      packages: headerPackages,
      policies: headerPolicies,
      controlPackagesSkipped,
    },
    recordSet,
    elapsedMs: totalMs,
    // (fold 1 F8) Timings live HERE, outside `rows[]`/`probeRows[]`: the two row
    // lists must be byte-identical between the scorer's evidence clone and its
    // replay clone, and a wall clock cannot be.
    timings: { totalMs, perPackage: perPackageTimings },
    rows,
    probeRows,
    checks: checks.rows,
  });

  console.log(
    `\nT5 sweep: ${rows.length} package(s) x ${paths.length} tree paths + ${probePaths.length} probe paths in ${totalMs} ms — ${disagreeing(rows)} package(s) with tree disagreements, ${disagreeing(probeRows)} with probe disagreements (deposited)`,
  );
  console.log(`t5 sweep -> ${out}`);
  checks.finish('t5-sweep');
}

await main();
