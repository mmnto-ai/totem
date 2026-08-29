// ─── T5 — the scope sweep, LOWERED vs SHIPPED, over the record-pin tree ──────
//
// Spec `.totem/specs/seed20-apparatus-slice2.md` § S6. T5 asks one question per
// (record, path): does the LOWERED policy's `in_scope` agree with the SHIPPED
// `ruleAppliesToFile`? The corpus is the tree at the RECORD PIN — the repository
// the seed records were written against — not the tree this run happens to sit on.
//
// THE MEASUREMENT IS BINDING. Any disagreement is a FAILED check and the run
// refuses: a lowered scope that admits a file the shipped rule excludes (or the
// reverse) is a semantic divergence in the exact axis this trial exists to measure,
// and reporting it as a row for someone else to notice would be the failure mode.
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

/** The exact argv this stage runs, with the per-package holes named. */
const INVOCATION =
  '<OPA_BIN> eval --format=json --strict-builtin-errors ' +
  '-d artifacts/lowered/<pkg>/policy.rego -d rego/build/<subdir>/<pkg>/t5-sweep.rego ' +
  '-i <input.json> data.t5sweep.in_scope_paths';

interface LoweringRow {
  specimen: string;
  seedEntry: string | null;
  control: boolean;
  package: string;
}

function spikeRel(abs: string): string {
  return path.relative(SPIKE_ROOT, abs).split(path.sep).join('/');
}

/** One `opa eval`, with a non-zero exit raised as the hard failure it is. */
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
  if (pinHeader === undefined) {
    throw new Error(
      'the run manifest carries no `trackedPathsAtRecordPin` — re-run `npm run manifest` (it enumerates the sweep corpus).',
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
      contract:
        'spec `.totem/specs/seed20-apparatus-slice2.md` § S6 — T5 scope sweep. NOT MEASURED in this run.',
      status: 'SKIPPED — record pin commit not present locally',
      header: {
        recordPin: pinHeader.pin,
        treeCount: 0,
        treeSha256: null,
        invocation: INVOCATION,
        mode: 'batched-set-comprehension',
        opaVersion: null,
        wrapperTemplateSha256,
        packages: [],
      },
      packages: [],
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
  const paths = listText.split('\n').filter((l) => l.length > 0);
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
  const lowering = JSON.parse(fs.readFileSync(loweringAt, 'utf-8')) as { lowered: LoweringRow[] };

  const core = await loadCore();
  const intake = intakeRecordSet(core);
  const compiledById = new Map(intake.accepted.map((r) => [r.specimen.id, r.compiled!]));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-t5-'));
  const inputAt = path.join(tmp, 'sweep-input.json');
  fs.writeFileSync(inputAt, `${JSON.stringify({ paths })}\n`, 'utf-8');
  // `opa eval -i` takes a FILE, never inline JSON, so the per-path cross-check
  // rewrites this one rather than trying to pass a document on the command line.
  const singleInputAt = path.join(tmp, 'single-input.json');

  const headerPackages: Record<string, unknown>[] = [];
  const packages: Record<string, unknown>[] = [];
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

    const argv = [
      'eval',
      '--format=json',
      '--strict-builtin-errors',
      '-d',
      spikeRel(policyAt),
      '-d',
      spikeRel(wrapperAt),
      '-i',
      inputAt,
      'data.t5sweep.in_scope_paths',
    ];
    const started = Date.now();
    const value = evalQuery(argv, `${suffix} (batched)`);
    const elapsedMs = Date.now() - started;
    const inScope = [...((value as string[] | undefined) ?? [])].sort();

    // ── the SHIPPED reading of the same corpus ──
    const compiled = compiledById.get(row.specimen);
    if (!compiled) {
      throw new Error(
        `no compiled rule for lowered record '${row.specimen}' — the lowering artifact and the loaded record set disagree; re-run \`npm run lower\`.`,
      );
    }
    const shippedApplies = paths
      .filter((p) => core.ruleAppliesToFile(compiled.rule, p) === true)
      .sort();

    const inScopeSet = new Set(inScope);
    const shippedSet = new Set(shippedApplies);
    const disagreements = paths
      .filter((p) => inScopeSet.has(p) !== shippedSet.has(p))
      .map((p) => ({ path: p, in_scope: inScopeSet.has(p), ruleAppliesToFile: shippedSet.has(p) }));

    checks.eq(
      `T5 — ${suffix}: the LOWERED \`in_scope\` and the SHIPPED \`ruleAppliesToFile\` agree on all ${paths.length} record-pin paths`,
      disagreements.slice(0, 10),
      [],
    );

    // ── the batched form, cross-checked against the PER-PATH form ──
    const sample = [...inScope.slice(0, 4), ...paths.filter((p) => !inScopeSet.has(p)).slice(0, 4)];
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
        `${suffix} (per-path ${p})`,
      );
      perPath.push({ path: p, batched: inScopeSet.has(p), single: single === true });
    }
    checks.eq(
      `T5 — ${suffix}: the BATCHED set comprehension agrees with the PER-PATH \`in_scope\` query on ${sample.length} sampled paths (${inScope.length ? Math.min(4, inScope.length) : 0} in scope, ${sample.length - Math.min(4, inScope.length)} out)`,
      perPath.filter((r) => r.batched !== r.single),
      [],
    );

    headerPackages.push({
      pkg: row.package,
      recordId: row.specimen,
      seedEntry: row.seedEntry ?? null,
      control: row.control === true,
      policyRegoSha256: sha256(fs.readFileSync(policyAt)),
      wrapperSha256: sha256(wrapperText),
    });
    packages.push({
      pkg: row.package,
      inScope,
      shippedApplies,
      disagreements,
      elapsedMs,
    });
  }

  const totalMs = Date.now() - startedAll;

  const out = writeArtifact('t5-sweep.json', {
    generatedBy: 'spikes/spine-adopt/src/t5-sweep.mts',
    contract:
      'spec `.totem/specs/seed20-apparatus-slice2.md` § S6 — T5 scope sweep. The charter names a per-path pair {in_scope, ruleAppliesToFile}; it is DERIVED from the two sorted lists below (`in_scope` = path ∈ `inScope`, `ruleAppliesToFile` = path ∈ `shippedApplies`), so the deposit is O(in-scope) rather than O(tree) per package and loses nothing. Every disagreement is listed in full AND is a FAILED check — T5 is binding.',
    status: 'MEASURED',
    header: {
      recordPin: pinHeader.pin,
      treeCount: paths.length,
      treeSha256: sha256(listText),
      invocation: INVOCATION,
      mode: 'batched-set-comprehension',
      opaVersion,
      wrapperTemplateSha256,
      packages: headerPackages,
    },
    recordSet,
    elapsedMs: totalMs,
    packages,
    checks: checks.rows,
  });

  const disagreeing = packages.filter((p) => (p.disagreements as unknown[]).length > 0).length;
  console.log(
    `\nT5 sweep: ${packages.length} package(s) x ${paths.length} paths in ${totalMs} ms — ${disagreeing} package(s) with disagreements`,
  );
  console.log(`t5 sweep -> ${out}`);
  checks.finish('t5-sweep');
}

await main();
