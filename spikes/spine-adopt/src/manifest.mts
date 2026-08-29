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
  BASELINE_PIN,
  byteIdentityRows,
  K3_CAPTURE_POLICY_CODE_SHA256,
  K3_CAPTURE_SHA256,
  K8_FIXTURE_SHA256,
  policyRegoCodeText,
  spikeFileDigest,
} from './lib/baseline-pins.mts';
import {
  activeRecordSet,
  controlBundleFixtureIds,
  controlRecordPath,
  generatedSeedProbes,
  K3_CAPTURE_CHAIN,
  K3_CAPTURE_POLICY,
  K5_CONTROL_RECORD,
  K5_CONTROL_SIBLING,
  K8_FIXTURES,
  loadRecordSet,
  PROBE_GENERATION_RULE,
  type RecordRow,
  SEED_RECORD_PIN,
  sharedProbePaths,
  SPECIMEN_PROBE_PATHS,
} from './lib/record-sets.mts';
import {
  ARTIFACTS_DIR,
  ARTIFACTS_SUBDIR,
  Checks,
  computeBundlesSha256,
  computeRunManifestSha256,
  MANIFEST_ARTIFACT,
  OPA_BIN,
  REPO_ROOT,
  sha256,
  SPIKE_ROOT,
  TRACKED_PATHS_ARTIFACT,
  TRACKED_PATHS_AT_RECORD_PIN_ARTIFACT,
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

/**
 * (fold 1 F13) The DEV seam for the clean-tree gate.
 *
 * `SPIKE_ALLOW_DIRTY_TREE=1` turns the `seed20`/`control` clean-tree FAIL check back
 * into a recorded fact, because the slice's own § Verification loop runs the seed
 * seam from a branch with uncommitted work by construction. The run of record does
 * not set it, and the header states which arm the run is on either way.
 */
const ALLOW_DIRTY_TREE = process.env.SPIKE_ALLOW_DIRTY_TREE === '1';

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

  // ── the clean-tree fact, measured FIRST — before this stage writes anything ──
  //
  // Fold 1 F13 (`.totem/specs/seed20-apparatus-slice2-fold1.md`) made a dirty tree
  // a FAIL check on `seed20`/`control`, and the first exercise of that gate on a
  // clean checkout refused itself: `tracked-paths.txt` is a COMMITTED artifact
  // that this very stage regenerates, so measuring `git status --porcelain`
  // after the write read the stage's own output as dirt. The fact the manifest
  // attests is "was the tree clean when the run STARTED" — so it is taken here,
  // before the first byte is written, and recorded as `workingTreeClean`.
  const status = run('git', ['status', '--porcelain'], REPO_ROOT);
  if (!status.ok)
    throw new Error(`\`git status --porcelain\` failed in ${REPO_ROOT}: ${status.out}`);
  const dirtyEntries = status.out.split('\n').filter((l) => l.trim().length > 0);

  // ── the record bytes, re-hashed at run time (constraint 5) ──
  //
  // (C5) `records[]` is the SCORED corpus and keeps its shape exactly; the K-control
  // rows are published separately as `controlRecords[]`. The split is the manifest's
  // job precisely so no downstream reader has to filter a mixed list correctly — and
  // the cardinality asserts that need the whole loaded set add the two lengths.
  const rowDigest = (r: RecordRow) => ({
    file: path.relative(REPO_ROOT, r.recordFile).split(path.sep).join('/'),
    sha256: sha256(fs.readFileSync(r.recordFile)),
    seedEntry: r.seedEntry,
    ruleId: r.ruleId,
  });
  const records = rows.filter((r) => !r.control).map(rowDigest);
  const controlRecords = rows
    .filter((r) => r.control)
    .map((r) => ({
      file: rowDigest(r).file,
      sha256: rowDigest(r).sha256,
      control: true as const,
      // (C5 / fold 1 F5) PRESENT-AS-NULL, never omitted. A control row is not a
      // seed entry by construction, and a reader grouping rows by `seedEntry` must
      // not have to tell "no entry" apart from "this producer omits the key".
      seedEntry: r.seedEntry,
      ruleId: r.ruleId,
      // The package a control record lowers to (§ Lowering 1). No control row is
      // twinned, so it never takes a `_<discriminator>` suffix.
      package: `totem.spike.r${r.ruleId}`,
      // `K5` for the in-set M3 control (§ S3); the `control` record set's single row
      // is K3 arm B (§ S5), which is the only other control record that loads.
      role: path.resolve(r.recordFile) === path.resolve(K5_CONTROL_RECORD) ? 'K5' : 'K3',
      // (fold 1 F5) The fact bundles this control row is DECLARED to mint, named at
      // manifest time from the record's own bytes. `src/facts.mts` asserts after
      // minting that the bundles carrying this row's specimen id are exactly these —
      // so a control whose bundles silently went missing, or gained one, is a FAILED
      // check rather than an absence the scorer has to notice.
      bundleFixtureIds: controlBundleFixtureIds(r),
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

  // `workingTreeClean` was measured at the top of main(), BEFORE the write above
  // (T17 records it; fold 1 F13 gates it on the seed sets — see there).

  const head = run('git', ['rev-parse', 'HEAD'], REPO_ROOT);
  if (!head.ok) throw new Error(`\`git rev-parse HEAD\` failed in ${REPO_ROOT}: ${head.out}`);

  // ── (§ S6) T5's sweep corpus: the tree at the RECORD PIN ──
  //
  // Distinct from `trackedPaths` above, which is the tree at `runCommit` (T17
  // provenance). T5 asks whether the lowered scope agrees with the shipped scope
  // over the repository THE RECORDS WERE WRITTEN AGAINST, so the sweep set is the
  // pinned tree — 2,742 paths at `2a713576…`.
  //
  // A shallow clone has no pin (the `verify-records.mts` skip class): the list is
  // then absent, `present: false` is recorded, and `src/t5-sweep.mts` publishes a
  // SKIPPED sweep with a named reason instead of an empty measurement.
  const pinProbe = run('git', ['cat-file', '-e', `${SEED_RECORD_PIN}^{commit}`], REPO_ROOT);
  const pinTree = pinProbe.ok
    ? run('git', ['ls-tree', '-r', '--name-only', SEED_RECORD_PIN], REPO_ROOT)
    : { ok: false, out: pinProbe.out };
  const pinList = pinTree.ok
    ? pinTree.out
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .sort()
    : [];
  const pinText = `${pinList.join('\n')}\n`;
  if (pinTree.ok) {
    fs.writeFileSync(
      path.join(ARTIFACTS_DIR, TRACKED_PATHS_AT_RECORD_PIN_ARTIFACT),
      pinText,
      'utf-8',
    );
  }

  // ── (§ S2) the K3 capture, and the § 5 comment-stripped digest ──
  const k3PolicyText = fs.existsSync(K3_CAPTURE_POLICY)
    ? fs.readFileSync(K3_CAPTURE_POLICY, 'utf-8')
    : null;
  // The § 5 CODE-ONLY digest, under the CHARTER's formula (fold 1 F1): the emitted
  // policy minus lines whose first non-blank character is `#`, `\n`-joined. Blank
  // lines are KEPT and there is no trailing newline — `score.mjs` computes the same
  // number on its side of the seam, and a formula that differs by one byte produces
  // a digest that agrees with nothing.
  const policyRegoSha256 = spikeFileDigest('seed/controls/k3/k3-target.policy.rego');
  const policyRegoCodeSha256 =
    k3PolicyText === null ? null : sha256(policyRegoCodeText(k3PolicyText));
  const chainSha256 = spikeFileDigest('seed/controls/k3/k3-target.chain.json');
  // (fold 1 F2) `repinned: false` = the PINNED TARGET STANDS — all three recomputed
  // digests equal the pins. `true` puts the measured values in `repinnedDigests`
  // beside, so the scorer reads the disclosure from the manifest rather than
  // discovering a moved target by comparing against a number nobody published.
  const k3Pins = {
    policyRegoSha256: K3_CAPTURE_SHA256['seed/controls/k3/k3-target.policy.rego']!,
    policyRegoCodeSha256: K3_CAPTURE_POLICY_CODE_SHA256,
    chainSha256: K3_CAPTURE_SHA256['seed/controls/k3/k3-target.chain.json']!,
  };
  const k3Measured = { policyRegoSha256, policyRegoCodeSha256, chainSha256 };
  const k3Repinned =
    policyRegoSha256 !== k3Pins.policyRegoSha256 ||
    policyRegoCodeSha256 !== k3Pins.policyRegoCodeSha256 ||
    chainSha256 !== k3Pins.chainSha256;
  const k3Capture = {
    policyRegoSha256,
    policyRegoCodeSha256,
    chainSha256,
    repinned: k3Repinned,
    ...(k3Repinned ? { repinnedDigests: { pinned: k3Pins, measured: k3Measured } } : {}),
    files: {
      policyRego: path.relative(SPIKE_ROOT, K3_CAPTURE_POLICY).split(path.sep).join('/'),
      chain: path.relative(SPIKE_ROOT, K3_CAPTURE_CHAIN).split(path.sep).join('/'),
    },
  };

  // ── (§ S4) K6 byte identity against the baseline pin ──
  const byteIdentity = { baselinePin: BASELINE_PIN, files: byteIdentityRows() };
  const disclosedDeltas = byteIdentity.files.filter((r) => !r.eq && r.disclosed !== null);
  const undisclosedDeltas = byteIdentity.files.filter((r) => !r.eq && r.disclosed === null);

  // (fold 1 F4/N3) PUBLISHED SORTED on every set — the digest below attests the
  // published order, so the list a reader hashes is the list a reader sees. The
  // FROZEN order the specimens' `globs.json` serialises is a separate thing and is
  // published separately, as `probeGeneration.frozen`.
  const probePaths = [...sharedProbePaths(recordSet)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const probePathsText = `${probePaths.join('\n')}\n`;

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
    probePaths,
    // (§ S2) The probe list is a chain-digest input on the specimens set and a
    // GENERATED set on the seed set, so its identity is published beside it rather
    // than left for a reader to recompute with a different join/sort convention.
    // Same shape as `trackedPaths.sha256`: sorted, `\n`-joined, trailing newline.
    probePathsSha256: sha256(probePathsText),
    // (§ S1/§ S2) How the seed's probes were DERIVED, and what the derivation
    // produced. `[]` on `specimens`, whose list is frozen literals by construction.
    probeGeneration: {
      rule: PROBE_GENERATION_RULE,
      globCount: recordSet === 'seed20' ? generatedSeedProbes().length : 0,
      pairs: recordSet === 'seed20' ? generatedSeedProbes() : [],
      // (fold 1 F3) The FROZEN 22, in AUTHORED order — the order they are serialised
      // into each specimen's `globs.json`, whose sha256 is a chain component. It is
      // an apparatus CONSTANT: the scorer cannot derive it from the corpus, and
      // without it the sorted `probePaths` above cannot be split back into "frozen"
      // and "generated". Published on every set, unchanged by the record set.
      frozen: [...SPECIMEN_PROBE_PATHS],
    },
    // (C5/§ S3) The K-control records that LOADED this run, split out of `records`
    // so the scorer never has to filter the scored corpus itself.
    controlRecords,
    // (§ S7, K8) The two § Design 5 rejection fixtures, byte-pinned in the tree.
    // They are not records the pipeline lowers — `src/controls.mts` parses them and
    // asserts each is REFUSED — so they are published as fixtures, not as records.
    controlFixtures: K8_FIXTURES.map((f) => ({
      id: f.id,
      file: path.relative(SPIKE_ROOT, f.file).split(path.sep).join('/'),
      sha256: fs.existsSync(f.file) ? sha256(fs.readFileSync(f.file)) : null,
      expect: f.expect,
    })),
    k3Capture,
    byteIdentity,
    trackedPaths: {
      source:
        'git ls-tree -r --name-only HEAD, sorted (T5 sweep set — the tree at `runCommit`, not the index)',
      list: `artifacts/${TRACKED_PATHS_ARTIFACT}`,
      count: trackedList.length,
      sha256: sha256(trackedText),
    },
    // (§ S6) T5's sweep corpus — the tree at the RECORD PIN, not at `runCommit`.
    // `present: false` is the honest state in a clone without the pin's history;
    // `src/t5-sweep.mts` then publishes a SKIPPED sweep rather than an empty one.
    trackedPathsAtRecordPin: {
      pin: SEED_RECORD_PIN,
      present: pinTree.ok,
      count: pinList.length,
      sha256: pinTree.ok ? sha256(pinText) : null,
      file: `artifacts/${TRACKED_PATHS_AT_RECORD_PIN_ARTIFACT}`,
    },
    // (C10) `null` when unset — the run wrote into the default roots.
    artifactsSubdir: ARTIFACTS_SUBDIR,
    // (C11/§ S5) The `SPIKE_CONTROL_RECORD` path, or `null`.
    controlRecord: controlRecordPath(),
    // Filled by `src/facts.mts` (§ G5, "filled after facts"). Outside the digest
    // preimage, so filling it cannot move the identity earlier artifacts carry.
    bundles: [] as { fixtureId: string; sha256: string }[],
    // T15 — computed by `fillManifestBundles` from the list above, and embedded
    // beside `runManifestSha256` in every artifact written after facts. `null` here
    // is the honest pre-facts state: the bundle set does not exist yet.
    //
    // (§ S5) EXCEPT on the `control` set, whose seam is
    // `manifest -> lower -> build-wasm -> certify` and has NO fact stage at all: the
    // bundle set for that run is EMPTY, and the digest of the empty list is the
    // honest value rather than a gap. Without it every post-facts artifact the
    // control seam writes would refuse for a stage that is not supposed to run.
    bundlesSha256: recordSet === 'control' ? computeBundlesSha256([]) : (null as string | null),
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

  // ── (§ S4) THE ENVIRONMENT HEADER, printed BEFORE any check ──
  //
  // One block, at the top of the run's log, naming every axis a reader would
  // otherwise have to reconstruct from an artifact: which corpus, which commit,
  // whether the tree was clean, which artifact set, which baseline, and what the
  // toolchain actually RESOLVED to. The Go arm prints the same block at its own
  // run-start (§ S9), so a two-language run reads as one run.
  const tc = manifest.toolchain as Record<string, Resolved>;
  const eqRows = byteIdentity.files.filter((r) => r.eq).length;
  console.log('─── spine-adopt run ─────────────────────────────────────────────');
  console.log(`  record set        ${recordSet}`);
  console.log(`  runCommit         ${head.out}`);
  console.log(`  workingTreeClean  ${String(manifest.workingTreeClean)}`);
  console.log(`  recordPin         ${SEED_RECORD_PIN}`);
  console.log(`  artifactsSubdir   ${ARTIFACTS_SUBDIR ?? '(none)'}`);
  console.log(`  controlRecord     ${controlRecordPath() ?? '(none)'}`);
  console.log(`  BASELINE_PIN      ${BASELINE_PIN}`);
  console.log(
    `  platform          ${process.platform}/${process.arch} (${os.release()})  node ${process.versions.node}`,
  );
  console.log(
    `  toolchain         ${[
      'opa',
      'node',
      'go',
      'rust',
      'wazero',
      'wasmtime',
      'regorus',
      'opaWasm',
      'astGrepNapi',
    ]
      .map((k) => `${k}=${tc[k]?.version ?? 'NULL'}`)
      .join('  ')}`,
  );
  console.log(
    `  byteIdentity      ${eqRows}/${byteIdentity.files.length} regions byte-identical to ${BASELINE_PIN}`,
  );
  // (fold 1 F10) Every DISCLOSED delta is printed, with the owner's statement. A
  // disclosed delta is still a delta: burying it in an artifact key would let the
  // run read as clean in the log that a human actually looks at.
  for (const r of disclosedDeltas) {
    console.log(`  DISCLOSED DELTA   ${r.path} (${r.region}) — ${r.disclosed ?? ''}`);
  }
  // (fold 1 F13) Which arm the dirty-tree gate is on, stated in the header rather
  // than left to be inferred from the presence of a FAILED check.
  console.log(`  dirty tree allowed: ${ALLOW_DIRTY_TREE ? 'yes' : 'no'}`);
  console.log('─────────────────────────────────────────────────────────────────\n');

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
  // ── (fold 1 F4) the probe set: published sorted, and COMPLETE ──
  checks.eq(
    `\`probePaths\` is published in CODEPOINT order (${probePaths.length} paths; \`probePathsSha256\` attests that order)`,
    probePaths.filter((p, i) => i > 0 && !(probePaths[i - 1]! < p)),
    [],
  );
  // The frozen 22 are a chain-digest input and must survive every set unchanged as a
  // SUBSET of the published list (their ORDER is published separately, as
  // `probeGeneration.frozen`).
  checks.eq(
    'every one of the 22 frozen SPECIMEN_PROBE_PATHS is in the published probe set',
    SPECIMEN_PROBE_PATHS.filter((p) => !probePaths.includes(p)),
    [],
  );
  // On the seed set the list must additionally cover every record's own inline
  // example path and the one corpus fixture — the paths each record is authored
  // against. A sweep that omitted them measured scope over paths no record names.
  const seedScoped = rows.filter((r) => !r.control);
  checks.eq(
    `every seed record's \`inlineFilePath\` and \`fixture.file\` is in the published probe set (${seedScoped.length} scored record(s))`,
    recordSet === 'seed20'
      ? [
          ...seedScoped.map((r) => r.inlineFilePath),
          ...seedScoped.flatMap((r) => (r.fixture ? [r.fixture.file] : [])),
        ].filter((p) => !probePaths.includes(p))
      : [],
    [],
  );
  // (fold 1 F13) GATED on `seed20` and `control`, RECORDED on `specimens`.
  //
  // The run of record's artifacts claim to be the artifacts of `runCommit`. If the
  // tree was dirty, they are the artifacts of something nobody can name — and the
  // scorer, reading `workingTreeClean: false` in a manifest whose run already
  // exited 0, would be refusing a run the apparatus had already called green.
  // `SPIKE_ALLOW_DIRTY_TREE=1` is the DEV seam (the § Verification loop runs on a
  // branch with uncommitted work by construction); the run of record does not set
  // it, and the header prints which arm this run is on.
  //
  // On `specimens` it stays recorded-not-gated: `npm run all` is the developer loop
  // and a manifest that refused over a scratch file would take it down.
  const dirtyDetail =
    manifest.workingTreeClean === true
      ? 'clean'
      : `DIRTY: ${dirtyEntries.length} entr${dirtyEntries.length === 1 ? 'y' : 'ies'} from \`git status --porcelain\` — ${dirtyEntries
          .slice(0, 5)
          .map((l) => l.trim())
          .join('; ')}${dirtyEntries.length > 5 ? '; …' : ''}`;
  const dirtyGated = (recordSet === 'seed20' || recordSet === 'control') && !ALLOW_DIRTY_TREE;
  checks.check(
    dirtyGated
      ? `the working tree at \`runCommit\` is CLEAN — REQUIRED on \`${recordSet}\` (§ S4 / fold 1 F13; set SPIKE_ALLOW_DIRTY_TREE=1 for a dev run)`
      : "the working tree state at `runCommit` is RECORDED (not gated — a dirty tree is the scorer's to refuse)",
    !dirtyGated || manifest.workingTreeClean === true,
    ALLOW_DIRTY_TREE ? `${dirtyDetail} — SPIKE_ALLOW_DIRTY_TREE=1 (dev run)` : dirtyDetail,
  );
  const unresolved = Object.entries(manifest.toolchain as Record<string, Resolved>)
    .filter(([, v]) => v.version === null)
    .map(([k, v]) => `${k} (${v.resolvedFrom}: ${v.unresolvedReason ?? 'unresolved'})`);
  // (§ S4) RECORDED on `specimens` — `npm run all` does not need cargo or go, and a
  // manifest that refused to be written on a machine without them would take the
  // developer loop down with it. On `seed20` and `control` an unresolved version is
  // a FAILED check: those are the sets a trial run is scored from, and "which
  // wasmtime was this measured on" has no honest answer if the manifest says null.
  const toolchainGated = recordSet === 'seed20' || recordSet === 'control';
  checks.check(
    toolchainGated
      ? `every toolchain version RESOLVED from a binary or a lockfile — REQUIRED on \`${recordSet}\` (§ S4)`
      : 'every toolchain version was RESOLVED from a binary or a lockfile (never declared)',
    !toolchainGated || unresolved.length === 0,
    unresolved.length === 0
      ? Object.entries(manifest.toolchain as Record<string, Resolved>)
          .map(([k, v]) => `${k}=${v.version}`)
          .join(', ')
      : `UNRESOLVED (recorded as null, not fabricated): ${unresolved.join('; ')}`,
  );

  // ── (§ S4) K6 — one check per pinned region ──
  //
  // A delta is a FAILED check and the run refuses — UNLESS the symbol is on
  // `EXPECTED_DELTAS` with the owner's benignity statement (fold 1 F10), in which
  // case the row is DISCLOSING: it reads true, and the statement is both the check's
  // detail and a line in the header. Whether a delta is benign is the owner's to
  // state in the design record; the apparatus only ever CARRIES that statement — it
  // has none of its own, and an undisclosed delta still refuses.
  for (const r of byteIdentity.files) {
    if (r.disclosed !== null) {
      checks.check(
        `K6 — \`${r.path}\` (${r.region}) DIFFERS from BASELINE_PIN ${BASELINE_PIN}, DISCLOSED by the owner`,
        true,
        `${r.expected} -> ${r.actual ?? 'null'} — ${r.disclosed}`,
      );
      continue;
    }
    checks.eq(
      `K6 — \`${r.path}\` (${r.region}) is byte-identical to BASELINE_PIN ${BASELINE_PIN}`,
      r.actual,
      r.expected,
    );
  }
  // The K3 captures, re-verified against their pinned digests at run time
  // (constraint 4) — the manifest publishes the shas, and this says they are the
  // shas of the bytes actually on disk.
  for (const [rel, expected] of Object.entries(K3_CAPTURE_SHA256)) {
    checks.eq(`K3 CAPTURE — \`${rel}\` matches its pinned sha256`, spikeFileDigest(rel), expected);
  }
  // (fold 1 F1) The § 5 comment-stripped digest, recomputed from the capture bytes
  // and asserted against the pin. This is the number `score.mjs` compares the
  // G7-published `policy.rego` against, so the apparatus states it as its own claim
  // under the charter's formula rather than publishing whatever its extractor
  // happened to compute.
  checks.eq(
    'K3 CAPTURE — the § 5 COMMENT-STRIPPED digest of `seed/controls/k3/k3-target.policy.rego` (charter formula: lines whose first non-blank char is `#` removed, `\\n`-joined, no trailing newline)',
    k3Capture.policyRegoCodeSha256,
    K3_CAPTURE_POLICY_CODE_SHA256,
  );
  checks.eq(
    'K3 CAPTURE — `repinned` is false: all three recomputed capture digests equal their pins, so the pinned K3 target STANDS',
    { repinned: k3Capture.repinned, undisclosedByteIdentityDeltas: undisclosedDeltas.length },
    { repinned: false, undisclosedByteIdentityDeltas: 0 },
  );
  for (const [rel, expected] of Object.entries(K8_FIXTURE_SHA256)) {
    checks.eq(`K8 FIXTURE — \`${rel}\` matches its pinned sha256`, spikeFileDigest(rel), expected);
  }
  // (§ S3, constraint 4) The K5 control record is checked by sha EQUALITY against
  // the sibling it copies, never against a constant: a constant would only prove
  // that the constant and the copy agree, and the claim is that the CONTROL and the
  // authored record are the same bytes.
  checks.eq(
    'K5 CONTROL — `seed/controls/k5/d-requires-file.rule.yaml` is byte-identical to `records/d-requires-file.rule.yaml`',
    fs.existsSync(K5_CONTROL_RECORD) ? sha256(fs.readFileSync(K5_CONTROL_RECORD)) : null,
    fs.existsSync(K5_CONTROL_SIBLING) ? sha256(fs.readFileSync(K5_CONTROL_SIBLING)) : null,
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
