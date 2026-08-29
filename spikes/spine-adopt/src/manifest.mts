// ─── The run manifest (spec `.totem/specs/seed20-apparatus.md` § G5) ─────────
//
// Written FIRST — `npm run manifest`, and step 0 of `npm run all` — so every
// artifact the pipeline goes on to write can be stamped with ONE identity for the
// run: which record set, which commit, which record bytes, which toolchain, which
// machine.
//
// EVERY toolchain version here is RESOLVED, never declared: binaries are asked for
// their own version and lockfiles are read for the pinned crate/module versions.
// `toolchain.lock` states what SHOULD be installed; this states what WAS. A
// version that cannot be resolved is recorded as `null` beside the reason and the
// source that was consulted — a fabricated version would be worse than a gap, and
// the Rust/Go halves are not installed for every arm of the pipeline.
//
// Run: node --experimental-strip-types src/manifest.mts

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  activeRecordSet,
  loadRecordSet,
  SEED_RECORD_PIN,
  sharedProbePaths,
} from './lib/record-sets.mts';
import {
  ARTIFACTS_DIR,
  Checks,
  computeBundlesSha256,
  computeRunManifestSha256,
  MANIFEST_ARTIFACT,
  OPA_BIN,
  REPO_ROOT,
  sha256,
  SPIKE_ROOT,
  TRACKED_PATHS_ARTIFACT,
  writeArtifact,
} from './lib/spike-env.mts';

/** `packages/core/src/spine/record-lower.ts` — the byte-identity ground the charter names. */
const RECORD_LOWER_SOURCE = path.join(
  REPO_ROOT,
  'packages',
  'core',
  'src',
  'spine',
  'record-lower.ts',
);

interface Resolved {
  version: string | null;
  resolvedFrom: string;
  unresolvedReason?: string;
}

function run(cmd: string, args: string[], cwd = SPIKE_ROOT): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    return { ok: false, out: (r.stderr || r.stdout || String(r.error ?? 'no output')).trim() };
  }
  return { ok: true, out: (r.stdout ?? '').trim() };
}

/** Ask a binary for its own version, and pull the first version-looking token out. */
function fromBinary(label: string, cmd: string, args: string[]): Resolved {
  const r = run(cmd, args);
  const source = `${label}: \`${path.basename(cmd)} ${args.join(' ')}\``;
  if (!r.ok)
    return { version: null, resolvedFrom: source, unresolvedReason: r.out.split('\n')[0] ?? '' };
  const m = /\d+\.\d+(?:\.\d+)?/.exec(r.out);
  return m
    ? { version: m[0], resolvedFrom: source }
    : {
        version: null,
        resolvedFrom: source,
        unresolvedReason: `no version token in ${JSON.stringify(r.out)}`,
      };
}

/** A crate's RESOLVED version, read out of `host/Cargo.lock` (not out of Cargo.toml's range). */
function fromCargoLock(crate: string): Resolved {
  const at = path.join(SPIKE_ROOT, 'host', 'Cargo.lock');
  const source = `host/Cargo.lock [[package]] name = "${crate}"`;
  if (!fs.existsSync(at))
    return { version: null, resolvedFrom: source, unresolvedReason: 'Cargo.lock absent' };
  const text = fs.readFileSync(at, 'utf-8');
  const m = new RegExp(`^name = "${crate}"\\nversion = "([^"]+)"$`, 'm').exec(text);
  return m
    ? { version: m[1]!, resolvedFrom: source }
    : { version: null, resolvedFrom: source, unresolvedReason: 'no such package in the lock' };
}

/** A Go module's RESOLVED version, read out of `wazero-probe/go.mod`. */
function fromGoMod(module: string): Resolved {
  const at = path.join(SPIKE_ROOT, 'wazero-probe', 'go.mod');
  const source = `wazero-probe/go.mod require ${module}`;
  if (!fs.existsSync(at))
    return { version: null, resolvedFrom: source, unresolvedReason: 'go.mod absent' };
  // Line-scanned rather than regex-escaped: a module path is full of regex
  // metacharacters and the escaping is the only part that could go wrong.
  const line = fs
    .readFileSync(at, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.includes(`${module} v`) && !l.startsWith('//'));
  const version = line?.split(/\s+/).find((t) => /^v\d/.test(t));
  return version
    ? { version: version.slice(1), resolvedFrom: source }
    : { version: null, resolvedFrom: source, unresolvedReason: 'module not required in go.mod' };
}

/** `@ast-grep/napi`'s INSTALLED version — the ast facts in this run came from this build. */
function astGrepNapiVersion(): Resolved {
  const at = path.join(
    REPO_ROOT,
    'packages',
    'core',
    'node_modules',
    '@ast-grep',
    'napi',
    'package.json',
  );
  const source = 'packages/core/node_modules/@ast-grep/napi/package.json';
  if (!fs.existsSync(at)) {
    return {
      version: null,
      resolvedFrom: source,
      unresolvedReason: 'not installed — run `pnpm install`',
    };
  }
  const v = (JSON.parse(fs.readFileSync(at, 'utf-8')) as { version?: string }).version;
  return typeof v === 'string'
    ? { version: v, resolvedFrom: source }
    : { version: null, resolvedFrom: source, unresolvedReason: 'package.json carries no version' };
}

function main(): void {
  const checks = new Checks();
  const recordSet = activeRecordSet();
  const rows = loadRecordSet(recordSet);

  // ── the record bytes, re-hashed at run time (constraint 5) ──
  const records = rows.map((r) => ({
    file: path.relative(REPO_ROOT, r.recordFile).split(path.sep).join('/'),
    sha256: sha256(fs.readFileSync(r.recordFile)),
    seedEntry: r.seedEntry,
    ruleId: r.ruleId,
  }));

  // ── the corpus fixtures the set names ──
  const fixtures = [...new Set(rows.flatMap((r) => (r.fixture ? [r.fixture.file] : [])))]
    .sort()
    .map((file) => {
      const abs = path.join(REPO_ROOT, ...file.split('/'));
      return { file, sha256: fs.existsSync(abs) ? sha256(fs.readFileSync(abs)) : null };
    });

  // ── T5's sweep set: the tree at the RECORDED COMMIT, sorted, published beside
  //    the manifest ──
  //
  // `git ls-tree -r HEAD`, never `git ls-files` (mmnto-ai/totem#2694, T17):
  // `ls-files` reads the INDEX, so a staged add or a staged delete would put paths
  // in the sweep set that are not at the commit `runCommit` names — the manifest
  // would say HEAD and mean something else. The index's disagreement with the tree
  // is recorded separately, as `workingTreeClean`.
  const ls = run('git', ['ls-tree', '-r', '--name-only', 'HEAD'], REPO_ROOT);
  if (!ls.ok)
    throw new Error(`\`git ls-tree -r --name-only HEAD\` failed in ${REPO_ROOT}: ${ls.out}`);
  const trackedList = ls.out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .sort();
  const trackedText = `${trackedList.join('\n')}\n`;
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(ARTIFACTS_DIR, TRACKED_PATHS_ARTIFACT), trackedText, 'utf-8');

  // RECORDED, never gated (T17): the manifest states whether the tree the run
  // happened in matched the commit it names. A dirty tree is the SCORER's to refuse
  // — the apparatus emits the fact and decides no verdict (spec § "This slice is
  // APPARATUS, never scoring").
  const status = run('git', ['status', '--porcelain'], REPO_ROOT);
  if (!status.ok)
    throw new Error(`\`git status --porcelain\` failed in ${REPO_ROOT}: ${status.out}`);
  const dirtyEntries = status.out.split('\n').filter((l) => l.trim().length > 0);

  const head = run('git', ['rev-parse', 'HEAD'], REPO_ROOT);
  if (!head.ok) throw new Error(`\`git rev-parse HEAD\` failed in ${REPO_ROOT}: ${head.out}`);

  const manifest: Record<string, unknown> = {
    generatedBy: 'spikes/spine-adopt/src/manifest.mts',
    contract:
      'spec `.totem/specs/seed20-apparatus.md` § G5 — the run manifest. Every later artifact embeds `runManifestSha256` (named for the OPA `manifestSha256` collision; see src/lib/spike-env.mts).',
    recordSet,
    runCommit: head.out,
    // T17 — a FACT about the run, not a gate: `trackedPaths` below is the tree at
    // `runCommit`, and this says whether the tree the run actually read matched it.
    workingTreeClean: dirtyEntries.length === 0,
    recordPin: SEED_RECORD_PIN,
    recordPinApplies:
      recordSet === 'seed20'
        ? 'the records below are the byte-identical copies under seed/records/ (seed/PIN.md)'
        : 'the specimens set is authored in spikes/spine-adopt/records/; the pin names the seed set only',
    records,
    fixtures,
    probePaths: sharedProbePaths(recordSet),
    trackedPaths: {
      source:
        'git ls-tree -r --name-only HEAD, sorted (T5 sweep set — the tree at `runCommit`, not the index)',
      list: `artifacts/${TRACKED_PATHS_ARTIFACT}`,
      count: trackedList.length,
      sha256: sha256(trackedText),
    },
    // Filled by `src/facts.mts` (§ G5, "filled after facts"). Outside the digest
    // preimage, so filling it cannot move the identity earlier artifacts carry.
    bundles: [] as { fixtureId: string; sha256: string }[],
    // T15 — computed by `fillManifestBundles` from the list above, and embedded
    // beside `runManifestSha256` in every artifact written after facts. `null` here
    // is the honest pre-facts state: the bundle set does not exist yet.
    bundlesSha256: null as string | null,
    toolchain: {
      opa: fromBinary('the pinned OPA binary', OPA_BIN, ['version']),
      rust: fromBinary('the installed cargo', 'cargo', ['--version']),
      node: { version: process.versions.node, resolvedFrom: 'process.versions.node' },
      astGrepNapi: astGrepNapiVersion(),
      wazero: fromGoMod('github.com/tetratelabs/wazero'),
      go: fromBinary('the installed go toolchain', 'go', ['version']),
      wasmtime: fromCargoLock('wasmtime'),
      regorus: fromCargoLock('regorus'),
      opaWasm: fromCargoLock('opa-wasm'),
    },
    platform: { os: process.platform, arch: process.arch, release: os.release() },
    recordLowerSha256: fs.existsSync(RECORD_LOWER_SOURCE)
      ? sha256(fs.readFileSync(RECORD_LOWER_SOURCE))
      : null,
    recordLowerSource: 'packages/core/src/spine/record-lower.ts',
    generatedAt: new Date().toISOString(),
  };
  manifest.runManifestSha256 = computeRunManifestSha256(manifest);

  // `writeArtifact` deliberately does NOT stamp the manifest: it is the referent.
  const out = writeArtifact(MANIFEST_ARTIFACT, manifest);

  checks.eq('the manifest names the ACTIVE record set', manifest.recordSet, recordSet);
  checks.eq(
    `the manifest re-records a sha256 for every one of the ${records.length} record files`,
    records.filter((r) => !/^[0-9a-f]{64}$/.test(r.sha256)).map((r) => r.file),
    [],
  );
  checks.check(
    'every record file resolved a lessonHash and (on seed20) a seed entry',
    records.every((r) => /^[0-9a-f]{16}$/.test(r.ruleId)) &&
      (recordSet !== 'seed20' || records.every((r) => /^[0-9a-f]{8}$/.test(r.seedEntry ?? ''))),
    `${records.length} record(s)`,
  );
  checks.check(
    'the tracked-path sweep set is non-empty and published beside the manifest',
    trackedList.length > 0,
    `${trackedList.length} paths -> artifacts/${TRACKED_PATHS_ARTIFACT}`,
  );
  // RECORDED, never gated (T17). `ok` is deliberately `true` either way: a dirty
  // tree is a fact for the scorer, and a manifest that refused to be written in one
  // would take the whole pipeline down over a scratch file.
  checks.check(
    "the working tree state at `runCommit` is RECORDED (not gated — a dirty tree is the scorer's to refuse)",
    true,
    manifest.workingTreeClean === true
      ? 'clean'
      : `DIRTY: ${dirtyEntries.length} entr${dirtyEntries.length === 1 ? 'y' : 'ies'} from \`git status --porcelain\` — ${dirtyEntries
          .slice(0, 5)
          .map((l) => l.trim())
          .join('; ')}${dirtyEntries.length > 5 ? '; …' : ''}`,
  );
  const unresolved = Object.entries(manifest.toolchain as Record<string, Resolved>)
    .filter(([, v]) => v.version === null)
    .map(([k, v]) => `${k} (${v.resolvedFrom}: ${v.unresolvedReason ?? 'unresolved'})`);
  // A RECORDED gap, not a failure: `npm run all` does not need cargo or go, and a
  // manifest that refused to be written on a machine without them would take the
  // whole pipeline down with it. The gap is named so a run of record can be
  // rejected for it.
  checks.check(
    'every toolchain version was RESOLVED from a binary or a lockfile (never declared)',
    true,
    unresolved.length === 0
      ? Object.entries(manifest.toolchain as Record<string, Resolved>)
          .map(([k, v]) => `${k}=${v.version}`)
          .join(', ')
      : `UNRESOLVED (recorded as null, not fabricated): ${unresolved.join('; ')}`,
  );
  checks.eq(
    'the digest is stable under the pending `bundles` + `bundlesSha256` fill (both are outside the preimage)',
    computeRunManifestSha256({
      ...manifest,
      bundles: [{ fixtureId: 'x', sha256: 'y' }],
      bundlesSha256: computeBundlesSha256([{ fixtureId: 'x', sha256: 'y' }]),
    }),
    manifest.runManifestSha256,
  );
  // T15 — and the SECOND digest is a real function of the bundle bytes, order-free.
  // Without this the pre-facts digest would be the whole identity again, which is
  // exactly the gap it exists to close.
  const probeA = [
    { fixtureId: 'b', sha256: '2'.repeat(64) },
    { fixtureId: 'a', sha256: '1'.repeat(64) },
  ];
  const probeB = [
    { fixtureId: 'a', sha256: '1'.repeat(64) },
    { fixtureId: 'b', sha256: '2'.repeat(64) },
  ];
  const probeC = [
    { fixtureId: 'a', sha256: '1'.repeat(64) },
    { fixtureId: 'b', sha256: '3'.repeat(64) },
  ];
  checks.check(
    '`bundlesSha256` is order-INDEPENDENT and byte-SENSITIVE (T15 — different fact bytes cannot receive one run identity)',
    computeBundlesSha256(probeA) === computeBundlesSha256(probeB) &&
      computeBundlesSha256(probeB) !== computeBundlesSha256(probeC),
    `sorted-equal=${computeBundlesSha256(probeA) === computeBundlesSha256(probeB)}, bytes-differ=${
      computeBundlesSha256(probeB) !== computeBundlesSha256(probeC)
    }`,
  );

  console.log(
    `\nrecordSet=${recordSet}  records=${records.length}  runManifestSha256=${String(manifest.runManifestSha256).slice(0, 16)}…`,
  );
  console.log(`manifest: ${out}`);
  checks.finish('manifest');
}

main();
