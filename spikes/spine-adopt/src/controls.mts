// ─── The K-controls, as one artifact ─────────────────────────────────────────
//
// Spec `.totem/specs/seed20-apparatus-slice2.md` § S7 and C6. The ten controls the
// charter names (mmnto-ai/totem-strategy#1154) each live INLINE in the artifact
// that measures them — `certification-report.json`, `differential-report.json`,
// `lowering-rejects.json`, and so on. That is where they belong: a control is a
// property of the stage that produced it. But a scorer that has to reconstruct ten
// controls out of nine artifacts is a scorer that can miss one silently, so this
// stage SUMMARISES them into `artifacts/controls.json` and points, per row, at the
// inline home it read.
//
// THIS FILE DECIDES NO VERDICT. It reports `ok: true | false | null`, where `null`
// is NOT MEASURED — the input the control needs is absent, and the row names which
// input. A `refusing` control that measures `false` is an apparatus FAIL and this
// stage exits non-zero; a NOT-MEASURED row never is, because "the K7 rebuild has
// not happened yet" is not an apparatus fault. What a run of record may be scored
// on is strategy's to decide from these rows.
//
// Run: node --experimental-strip-types src/controls.mts
//      (AFTER `npm run differential` AND after the Go probe — the only position at
//       which every source below exists)

import * as fs from 'node:fs';
import * as path from 'node:path';

import { K3_CAPTURE_SHA256, spikeFileDigest } from './lib/baseline-pins.mts';
import {
  activeRecordSet,
  K3_CAPTURE_CHAIN,
  K3_CAPTURE_PACKAGE,
  K8_FIXTURES,
  type RecordSetId,
} from './lib/record-sets.mts';
import { loadCore, tryCompileSpecimen } from './lib/records.mts';
import { PINNED_RULE_ID, type Specimen } from './lib/specimens.mts';
import {
  ARTIFACTS_DIR,
  ARTIFACTS_SUBDIR,
  Checks,
  LOWERED_PUBLISH_DIR,
  readRunManifest,
  sha256,
  SPIKE_ROOT,
  writeArtifact,
} from './lib/spike-env.mts';

type Ok = boolean | null;

/**
 * A parsed artifact, read STRUCTURALLY.
 *
 * Every artifact this stage reads has a shape its own producer owns —
 * `certification-report.json` is `src/certify.mts`'s, `differential-report.json`
 * is `src/compare.mts`'s, and so on. Re-declaring nine producers' schemas here
 * would duplicate them and go stale silently, which is exactly the drift a control
 * summary must not have. The read sites name the path they read instead, and every
 * one of them is guarded (an absent input is `ok: null` with the input named), so
 * the type is deliberately open.
 */
type Artifact = any;

interface ControlRow {
  id: string;
  refusing: boolean;
  ok: Ok;
  detail: string;
  rows?: unknown[];
  evidence: { artifact: string; path: string }[];
}

/**
 * The K-control HOMES are named against the BASE artifact root, never against
 * `ARTIFACTS_DIR`: `artifacts/k4-swap/`, `artifacts/k7-rebuild/` and
 * `artifacts/k3-control/` are complete artifact SETS beside the run, and a controls
 * pass that itself ran under a subdir must still look for them where they are.
 */
const BASE_ARTIFACTS = path.join(SPIKE_ROOT, 'artifacts');
const K4_HOME = path.join(BASE_ARTIFACTS, 'k4-swap');
const K7_HOME = path.join(BASE_ARTIFACTS, 'k7-rebuild');
const K3_CONTROL_HOME = path.join(BASE_ARTIFACTS, 'k3-control');
const WAZERO_ARTIFACTS = path.join(
  SPIKE_ROOT,
  'wazero-probe',
  'artifacts',
  ...(ARTIFACTS_SUBDIR === null ? [] : [ARTIFACTS_SUBDIR]),
);

function readJson(at: string): Artifact | null {
  return fs.existsSync(at) ? JSON.parse(fs.readFileSync(at, 'utf-8')) : null;
}

function artifact(name: string): Artifact | null {
  return readJson(path.join(ARTIFACTS_DIR, name));
}

// ─── K3 arm A — the chain comparison, leaf path by leaf path ─────────────────

/**
 * The charter's TWO lists for K3 (mmnto-ai/totem-strategy#1154 § Controls, K3),
 * transcribed from the charter's own spellings, plus `seedEntry` (the 19:23Z
 * ruling: an ADDED key IS a differing field).
 *
 * "Any field that differs and is outside both lists refuses the run" — so a
 * differing path on NEITHER list is `UNCOVERED`, and a differing path on the
 * IDENTICAL list is a violation of a positive claim. Both make the control fail;
 * they are tagged apart so the reader knows which happened.
 */
const K3_EXPECTED_TO_DIFFER: readonly string[] = [
  'specimen',
  'seedEntry',
  'recordFile',
  'recordSha256',
  'regoComposition.components["policy.rego"]',
  'bundleTarballSha256',
  'determinism.bundleTarballSha256',
  'regoComposition.components["globs.json"]',
  'regoSha256',
  'regoComposition.preimage',
];

const K3_EXPECTED_IDENTICAL: readonly string[] = [
  'regoComposition.components["factSchemaLine"]',
  'regoComposition.factSchemaLine',
  'manifestSha256',
  'entrypointManifest.canonicalPreimage',
  'wasmSha256',
  'determinism.wasmIdentical',
  'determinism.tarballIdentical',
  'package',
  'entrypoint',
];

/**
 * Every LEAF path of a JSON object, with a key containing a `.` rendered
 * `parent["key.with.dot"]` — the charter's own spelling for
 * `regoComposition.components["policy.rego"]`, and the only rendering under which
 * that key is addressable at all. Arrays are leaves: the charter names
 * `determinism.bundleTarballSha256[]` as a whole.
 */
function leafPaths(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = k.includes('.') ? `${prefix}["${k}"]` : prefix === '' ? k : `${prefix}.${k}`;
      for (const [p, s] of leafPaths(v, key)) out.set(p, s);
    }
    return out;
  }
  out.set(prefix, JSON.stringify(value) ?? 'undefined');
  return out;
}

function compareChains(current: unknown, target: unknown) {
  const a = leafPaths(current);
  const b = leafPaths(target);
  const all = [...new Set([...a.keys(), ...b.keys()])].sort();
  const rows: { path: string; tag: string; current: string | null; target: string | null }[] = [];
  for (const p of all) {
    const left = a.get(p) ?? null;
    const right = b.get(p) ?? null;
    if (left === right) continue;
    const tag = K3_EXPECTED_TO_DIFFER.includes(p)
      ? 'expected-to-differ'
      : K3_EXPECTED_IDENTICAL.includes(p)
        ? 'identical-expected'
        : 'UNCOVERED';
    rows.push({
      path: p,
      tag,
      current: left === null ? null : left.slice(0, 200),
      target: right === null ? null : right.slice(0, 200),
    });
  }
  return rows;
}

// ─── The rows ────────────────────────────────────────────────────────────────

function k1(recordSet: RecordSetId, lowering: Artifact): ControlRow {
  const evidence = [{ artifact: 'lowering-rejects.json', path: 'rejects[]' }];
  if (lowering === null) {
    return {
      id: 'K1',
      refusing: true,
      ok: null,
      detail: 'NOT MEASURED — `artifacts/lowering-rejects.json` is absent (run `npm run lower`).',
      evidence,
    };
  }
  const rejects = (lowering.rejects ?? []) as Artifact[];
  const census = (id: string, cls: string) => {
    const row = rejects.find((r) => r.ruleHash === id);
    return {
      id,
      source: 'census-evidence',
      present: row !== undefined,
      class: row?.verdict?.class ?? null,
      expectedClass: cls,
      ok: row !== undefined && row.verdict?.class === cls,
    };
  };
  const rows: Artifact[] = [
    census('bddfbd2ec1c75eaf', 'lookaround'),
    census('80192e6ac2a1dd3c', 'backreference'),
  ];
  // The seed's own inert-lookahead seam: the third row the charter adds, because
  // the two census rows alone could still pass a lowerer that "provably-inert"-ed
  // a lookahead away. Seed-set only — the specimens set has no such record.
  if (recordSet === 'seed20') {
    const own = rejects.find(
      (r) => typeof r.recordId === 'string' && r.recordId.startsWith('0e01112d'),
    );
    rows.push({
      id: '0e01112d',
      source: 'record reject row',
      present: own !== undefined,
      stage: own?.stage ?? null,
      class: own?.class ?? null,
      expectedClass: 'lookaround',
      ok: own !== undefined && own.stage === 'target-lowering' && own.class === 'lookaround',
    });
  }
  const missing = rows.filter((r) => !r.ok);
  return {
    id: 'K1',
    refusing: true,
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? `${rows.length} classifier reject row(s) present with the class named${recordSet === 'seed20' ? '' : ' (the seed`s own `0e01112d` row is seed-only and is not part of this set)'}`
        : `MISSING or MISCLASSED: ${missing.map((r) => `${r.id} (class=${String(r.class)}, expected ${r.expectedClass})`).join('; ')}`,
    rows,
    evidence,
  };
}

function k2(report: Artifact): ControlRow {
  const evidence = [
    {
      artifact: 'certification-report.json',
      path: 'allHostsFailureRule.rows[fixture=neg-lookahead]',
    },
    { artifact: 'certification-report.json', path: 'certifications[id=fixture:neg-lookahead]' },
    { artifact: 'blocked/certfix_neg_lookahead.json', path: 'chain' },
  ];
  if (report === null) {
    return {
      id: 'K2',
      refusing: true,
      ok: null,
      detail:
        'NOT MEASURED — `artifacts/certification-report.json` is absent (run `npm run certify`).',
      evidence,
    };
  }
  const row = (report.allHostsFailureRule?.rows ?? []).find(
    (r: Artifact) => r.fixture === 'neg-lookahead',
  );
  const cert = (report.certifications ?? []).find(
    (c: Artifact) => c.id === 'fixture:neg-lookahead',
  );
  const blocked = readJson(path.join(ARTIFACTS_DIR, 'blocked', 'certfix_neg_lookahead.json'));
  // The HOST-level kinds, which are a different vocabulary from the certifier's
  // five `BLOCKED_REASONS` (`src/certify.mts` § (d)). The row says which it read so
  // the two are never conflated: `regorus: eval-error` is a host kind and has no
  // counterpart in the certifier's set.
  const expectedHostKinds: Record<string, string> = {
    'wasmtime (rust-opa-wasm)': 'empty-result-set',
    regorus: 'eval-error',
    wazero: 'empty-result-set',
  };
  const hostRows = (row?.hosts ?? []).map((h: Artifact) => ({
    host: h.host,
    errored: h.errored === true,
    cleanZero: h.cleanZero === true,
    kind: h.kind,
    expectedKind: expectedHostKinds[h.host] ?? null,
    ok: h.errored === true && h.cleanZero === false && h.kind === expectedHostKinds[h.host],
  }));
  const certOk = cert?.status === 'BLOCKED' && cert?.reason === 'empty-result-set';
  const chainNull = blocked !== null && blocked.chain === null;
  const ok =
    row !== undefined &&
    hostRows.length === 3 &&
    hostRows.every((h: Artifact) => h.ok) &&
    certOk &&
    chainNull;
  return {
    id: 'K2',
    refusing: true,
    ok,
    detail: ok
      ? 'certfix_neg_lookahead is BLOCKED `empty-result-set` by the certifier, and all three hosts produced an ERROR (host-level kinds: wasmtime empty-result-set, regorus eval-error, wazero empty-result-set — read from `allHostsFailureRule`, NOT from the certifier`s five-class vocabulary); the blocked artifact carries `chain: null`'
      : `certification status=${String(cert?.status)}/${String(cert?.reason)}, chain-null=${chainNull}, hosts=${JSON.stringify(hostRows.map((h: Artifact) => `${h.host}:${h.kind}:${h.ok}`))}`,
    rows: hostRows,
    evidence,
  };
}

function k3(recordSet: RecordSetId, manifest: Artifact): ControlRow {
  const evidence = [
    { artifact: `chains/${K3_CAPTURE_PACKAGE}.json`, path: '(arm A) every leaf path' },
    { artifact: 'seed/controls/k3/k3-target.chain.json', path: '(arm A) the pinned target' },
    {
      artifact: `k3-control/chains/${K3_CAPTURE_PACKAGE}.json`,
      path: '(arm B) the control-only rebuild',
    },
    { artifact: 'manifest.json', path: 'k3Capture' },
  ];

  // The manifest's published capture digests, re-verified against the files.
  const captureDrift = Object.entries(K3_CAPTURE_SHA256)
    .filter(([rel, expected]) => spikeFileDigest(rel) !== expected)
    .map(([rel]) => rel);
  const manifestCaptureOk =
    manifest?.k3Capture?.policyRegoSha256 ===
      K3_CAPTURE_SHA256['seed/controls/k3/k3-target.policy.rego'] &&
    manifest?.k3Capture?.chainSha256 === K3_CAPTURE_SHA256['seed/controls/k3/k3-target.chain.json'];

  // ── arm A ──
  let armA: { ok: Ok; detail: string; rows: unknown[] };
  if (recordSet !== 'seed20') {
    armA = {
      ok: null,
      detail: `NOT MEASURED — arm A compares the SEED run's \`chains/${K3_CAPTURE_PACKAGE}.json\` against the pinned target, and this run's record set is \`${recordSet}\``,
      rows: [],
    };
  } else {
    const current = readJson(path.join(ARTIFACTS_DIR, 'chains', `${K3_CAPTURE_PACKAGE}.json`));
    const target = readJson(K3_CAPTURE_CHAIN);
    if (current === null || target === null) {
      armA = {
        ok: null,
        detail: `NOT MEASURED — ${current === null ? `artifacts/chains/${K3_CAPTURE_PACKAGE}.json` : 'seed/controls/k3/k3-target.chain.json'} is absent`,
        rows: [],
      };
    } else {
      const rows = compareChains(current, target);
      const bad = rows.filter((r) => r.tag !== 'expected-to-differ');
      armA = {
        ok: bad.length === 0,
        detail:
          bad.length === 0
            ? `${rows.length} differing leaf path(s), every one on the charter's expected-to-differ list`
            : `${bad.filter((r) => r.tag === 'UNCOVERED').length} UNCOVERED and ${bad.filter((r) => r.tag === 'identical-expected').length} expected-identical-but-differing path(s): ${bad.map((r) => `${r.path} [${r.tag}]`).join('; ')}`,
        rows,
      };
    }
  }

  // ── arm B ──
  let armB: { ok: Ok; detail: string; rows: unknown[] };
  const armBChain = readJson(path.join(K3_CONTROL_HOME, 'chains', `${K3_CAPTURE_PACKAGE}.json`));
  const armBPolicyAt = path.join(K3_CONTROL_HOME, 'lowered', K3_CAPTURE_PACKAGE, 'policy.rego');
  if (!fs.existsSync(K3_CONTROL_HOME)) {
    armB = {
      ok: null,
      detail:
        'NOT MEASURED — control-only run not present: `artifacts/k3-control/` does not exist (run the § S5 seam with SPIKE_CONTROL_RECORD set)',
      rows: [],
    };
  } else if (armBChain === null || !fs.existsSync(armBPolicyAt)) {
    armB = {
      ok: null,
      detail: `NOT MEASURED — control-only run not present for ${K3_CAPTURE_PACKAGE}: ${armBChain === null ? 'its chain' : 'its published policy.rego'} is absent under artifacts/k3-control/`,
      rows: [],
    };
  } else {
    const chainSha = sha256(
      fs.readFileSync(path.join(K3_CONTROL_HOME, 'chains', `${K3_CAPTURE_PACKAGE}.json`)),
    );
    const policySha = sha256(fs.readFileSync(armBPolicyAt));
    const rows = [
      {
        file: `k3-control/chains/${K3_CAPTURE_PACKAGE}.json`,
        sha256: chainSha,
        expected: K3_CAPTURE_SHA256['seed/controls/k3/k3-target.chain.json'],
        eq: chainSha === K3_CAPTURE_SHA256['seed/controls/k3/k3-target.chain.json'],
      },
      {
        file: `k3-control/lowered/${K3_CAPTURE_PACKAGE}/policy.rego`,
        sha256: policySha,
        expected: K3_CAPTURE_SHA256['seed/controls/k3/k3-target.policy.rego'],
        eq: policySha === K3_CAPTURE_SHA256['seed/controls/k3/k3-target.policy.rego'],
      },
    ];
    armB = {
      ok: rows.every((r) => r.eq),
      detail: rows.every((r) => r.eq)
        ? 'the control-only rebuild reproduces the pinned chain AND the pinned policy.rego byte-for-byte'
        : rows
            .filter((r) => !r.eq)
            .map((r) => `${r.file}: ${r.sha256} != ${r.expected}`)
            .join('; '),
      rows,
    };
  }

  // One `ok` per control id (C6's shape), over the two arms plus the capture pins.
  // FALSE beats NULL: a measured failure is a failure whatever the other arm did.
  // NULL beats TRUE: K3 is the conjunction of its arms, and a run in which one arm
  // was never measured has not measured K3.
  const ok: Ok =
    captureDrift.length > 0 || !manifestCaptureOk || armA.ok === false || armB.ok === false
      ? false
      : armA.ok === null || armB.ok === null
        ? null
        : true;

  return {
    id: 'K3',
    refusing: true,
    ok,
    detail:
      `arm A: ${armA.detail} | arm B: ${armB.detail} | capture pins: ${captureDrift.length === 0 ? 'both re-verified against the tree' : `DRIFT ${captureDrift.join(', ')}`}` +
      ` | manifest.k3Capture: ${manifestCaptureOk ? 'matches the captures' : 'DOES NOT match the captures'}`,
    rows: [
      { arm: 'A', ok: armA.ok, detail: armA.detail, rows: armA.rows },
      { arm: 'B', ok: armB.ok, detail: armB.detail, rows: armB.rows },
    ],
    evidence,
  };
}

function k3b(recordSet: RecordSetId, lowering: Artifact): ControlRow {
  const evidence = [{ artifact: 'lowered/<pkg>/globs.json', path: 'perGlobProbes' }];
  if (lowering === null) {
    return {
      id: 'K3b',
      refusing: true,
      ok: null,
      detail: 'NOT MEASURED — `artifacts/lowering-rejects.json` is absent (run `npm run lower`).',
      evidence,
    };
  }
  // SEED-SET ONLY, for the same reason `src/lower.mts` gates its own per-glob
  // discrimination check there: the SPECIMENS probe list is frozen literals (a
  // chain-digest component, `src/lib/record-sets.mts` SPECIMEN_PROBE_PATHS) and
  // deliberately does not cover every specimen glob — specimen `a`'s `**/*.bash`,
  // `**/*.zsh`, `**/*.js` and `**/*.mjs` have no matching probe and cannot get one
  // without moving committed chain bytes. K3b is a claim about the SEED's generated
  // probe set (§ S1); reporting it as measured here would be reporting a different
  // claim under the same name.
  if (recordSet !== 'seed20') {
    return {
      id: 'K3b',
      refusing: true,
      ok: null,
      detail: `NOT MEASURED — K3b is a claim about the SEED's generated probe set (§ S1); this run's record set is \`${recordSet}\`, whose probe list is the frozen SPECIMEN_PROBE_PATHS (a chain-digest input) and does not cover every glob by construction`,
      rows: [],
      evidence,
    };
  }
  const rows: Artifact[] = [];
  for (const l of (lowering.lowered ?? []) as Artifact[]) {
    const suffix = String(l.package).replace(/^totem\.spike\./, '');
    const globs = readJson(path.join(LOWERED_PUBLISH_DIR, suffix, 'globs.json'));
    if (globs === null) {
      rows.push({ pkg: l.package, glob: null, ok: false, detail: 'globs.json absent' });
      continue;
    }
    // "matching" is the AGREEMENT of the lowered regex and the shipped matcher —
    // a disagreement is a T5 `scope-divergence`, not a K3b fault, and it is already
    // a FAIL check in `src/lower.mts`. Counted here from the agreeing rows only.
    const byGlob = new Map<string, { matching: number; nonMatching: number; disagree: number }>();
    for (const p of (globs.perGlobProbes ?? []) as Artifact[]) {
      const acc = byGlob.get(p.glob) ?? { matching: 0, nonMatching: 0, disagree: 0 };
      if (p.mine !== p.shipped) acc.disagree += 1;
      else if (p.mine === true) acc.matching += 1;
      else acc.nonMatching += 1;
      byGlob.set(p.glob, acc);
    }
    for (const [glob, acc] of byGlob) {
      rows.push({
        pkg: l.package,
        glob,
        matching: acc.matching,
        nonMatching: acc.nonMatching,
        scopeDivergences: acc.disagree,
        ok: acc.matching >= 1 && acc.nonMatching >= 1,
      });
    }
  }
  const blind = rows.filter((r) => !r.ok);
  return {
    id: 'K3b',
    refusing: true,
    ok: rows.length === 0 ? null : blind.length === 0,
    detail:
      rows.length === 0
        ? 'NOT MEASURED — no lowered package published a globs.json'
        : blind.length === 0
          ? `${rows.length} reachable glob(s), each with >=1 matching AND >=1 non-matching probe`
          : `BLIND globs: ${blind.map((r) => `${r.pkg}/${r.glob} (${r.matching}/${r.nonMatching})`).join('; ')}`,
    rows,
    evidence,
  };
}

function k4(): ControlRow {
  const evidence = [
    { artifact: 'k4-swap/facts-index.json', path: 'bundles[].swapped' },
    {
      artifact: 'k4-swap/opa-verdicts.json',
      path: 'verdictRows[] (T7: bad fires, good silent — the charter evaluates T7 on the opa-wasm arm)',
    },
    {
      artifact: 'k4-swap/differential-report.json',
      path: 'summary (T8: every pair still MATCHes)',
    },
  ];
  if (!fs.existsSync(K4_HOME)) {
    return {
      id: 'K4',
      refusing: true,
      ok: null,
      detail:
        'NOT MEASURED — `artifacts/k4-swap/` does not exist (run the § S8 K4 seam with SPIKE_SWAP_EXAMPLES + SPIKE_ARTIFACTS_SUBDIR=k4-swap)',
      evidence,
    };
  }
  const factsIndex = readJson(path.join(K4_HOME, 'facts-index.json'));
  const opaVerdicts = readJson(path.join(K4_HOME, 'opa-verdicts.json'));
  const differential = readJson(path.join(K4_HOME, 'differential-report.json'));
  const swapped = ((factsIndex?.bundles ?? []) as Artifact[]).filter((b) => b.swapped === true);
  if (factsIndex === null || opaVerdicts === null || differential === null) {
    return {
      id: 'K4',
      refusing: true,
      ok: null,
      detail: `NOT MEASURED — \`artifacts/k4-swap/\` exists but ${[
        factsIndex === null ? 'facts-index.json' : null,
        opaVerdicts === null ? 'opa-verdicts.json' : null,
        differential === null ? 'differential-report.json' : null,
      ]
        .filter(Boolean)
        .join(', ')} is absent (the swap run did not complete)${
        swapped.length > 0 ? `; ${swapped.length} bundle(s) ARE labelled swapped` : ''
      }`,
      rows: swapped.map((b) => ({ fixtureId: b.fixtureId, specimen: b.specimen, swapped: true })),
      evidence,
    };
  }
  // T7 on the swapped record, as the charter defines it (§ T7: `bad` fires with
  // >=1 violation and `good` is silent with no error row, on the opa-wasm arm).
  // Under the swap the two sources are exchanged, so T7 must FAIL — that is the
  // control's whole claim: T7 discriminates independently of parity.
  const swappedSpecimens = new Set(swapped.map((b) => b.specimen));
  const t7Rows = ((opaVerdicts.verdictRows ?? []) as Artifact[])
    .filter(
      (r) =>
        swappedSpecimens.has(r.specimen) &&
        typeof r.fixtureId === 'string' &&
        /-inline\d*-(bad|good)$/.test(r.fixtureId),
    )
    .map((r) => ({
      fixtureId: r.fixtureId,
      arm: /-bad$/.test(r.fixtureId) ? 'bad' : 'good',
      violations: Array.isArray(r.violations) ? r.violations.length : null,
      error: r.error ?? null,
    }));
  const badRows = t7Rows.filter((r) => r.arm === 'bad');
  const goodRows = t7Rows.filter((r) => r.arm === 'good');
  // T7 PASSES when every `bad` fires and every `good` is silent. Under the swap it
  // must not.
  const t7Passes =
    badRows.length > 0 &&
    badRows.every((r) => (r.violations ?? 0) >= 1) &&
    goodRows.every((r) => (r.violations ?? 0) === 0 && r.error === null);
  const t8AllMatch =
    (differential.summary?.total?.['UNEXPLAINED-DIVERGENCE'] ?? 1) === 0 &&
    (differential.summary?.total?.['EXPLAINED-DIVERGENCE'] ?? 0) >= 0;
  const ok = swapped.length > 0 && !t7Passes && t8AllMatch;
  return {
    id: 'K4',
    refusing: true,
    ok,
    detail: ok
      ? `${swapped.length} bundle(s) served swapped; T7 FAILS on the swapped record (bad/good inverted on the opa-wasm arm) while the differential still reports 0 unexplained divergences — T7 discriminates independently of parity`
      : `swappedBundles=${swapped.length}, t7StillPasses=${t7Passes}, differentialAllMatch=${t8AllMatch}`,
    rows: [...swapped.map((b) => ({ fixtureId: b.fixtureId, swapped: true })), ...t7Rows],
    evidence,
  };
}

function k5(
  shipped: Artifact,
  differential: Artifact,
  wazeroPairs: Artifact,
  recordSet: RecordSetId,
): ControlRow {
  const evidence = [
    {
      artifact: 'shipped-verdicts.json',
      path: 'verdictRows[fixtureId=*-control-unreadable|*-control-empty]',
    },
    { artifact: 'differential-report.json', path: 'pairs[left=shipped,right=opa]' },
    { artifact: 'wazero-pairs.json', path: 'pairs[left=opa,right=wazero]' },
  ];
  if (shipped === null || differential === null) {
    return {
      id: 'K5',
      refusing: true,
      ok: null,
      detail: `NOT MEASURED — ${shipped === null ? 'shipped-verdicts.json' : 'differential-report.json'} is absent`,
      evidence,
    };
  }
  const ids = ((shipped.verdictRows ?? []) as Artifact[])
    .map((r) => String(r.fixtureId))
    .filter((id) => id.endsWith('-control-unreadable') || id.endsWith('-control-empty'));
  if (ids.length === 0) {
    return {
      id: 'K5',
      refusing: true,
      ok: null,
      detail: `NOT MEASURED — this run minted no M3 control bundles (record set \`${recordSet}\` carries no \`requires.scope: file\` record)`,
      evidence,
    };
  }
  const rows: Artifact[] = [];
  for (const id of ids) {
    const row = ((shipped.verdictRows ?? []) as Artifact[]).find((r) => r.fixtureId === id);
    const pair = ((differential.pairs ?? []) as Artifact[]).find(
      (p) => p.fixtureId === id && p.left === 'shipped' && p.right === 'opa',
    );
    rows.push({
      fixtureId: id,
      fired: row?.fired ?? null,
      matchCount: row?.matchCount ?? null,
      error: row?.error ?? null,
      shippedVsOpa: pair?.status ?? null,
      ok:
        row?.fired === true &&
        row?.matchCount === 1 &&
        (row?.error ?? null) === null &&
        pair?.status === 'MATCH',
    });
  }
  // The opa–wazero half is only readable when the Go probe ran FOR THIS RUN. A
  // `wazero-pairs.json` from a different record set is a STALE artifact, and reading
  // it would be the derived-summary failure this apparatus exists to avoid.
  const wazeroFresh = wazeroPairs !== null && wazeroPairs.recordSet === recordSet;
  const wazeroRows = wazeroFresh
    ? ids.map((id) => {
        const p = ((wazeroPairs.pairs ?? []) as Artifact[]).find(
          (x) => x.fixtureId === id && x.left === 'opa' && x.right === 'wazero',
        );
        return { fixtureId: id, opaVsWazero: p?.status ?? null, ok: p?.status === 'MATCH' };
      })
    : [];
  const tsHalfOk = rows.every((r) => r.ok);
  const ok: Ok = !tsHalfOk ? false : !wazeroFresh ? null : wazeroRows.every((r) => r.ok);
  return {
    id: 'K5',
    refusing: true,
    ok,
    detail: !tsHalfOk
      ? `the M3 bundles did not report fired:true / matchCount:1 / error:null / MATCH — ${JSON.stringify(rows)}`
      : wazeroFresh
        ? `${rows.length} M3 bundle(s) fired with matchCount 1, no error, MATCH on shipped-opa AND opa-wazero`
        : `${rows.length} M3 bundle(s) verified on the TS arms; the opa-wazero half is NOT MEASURED — ${
            wazeroPairs === null
              ? 'wazero-probe/artifacts/wazero-pairs.json is absent'
              : `wazero-pairs.json carries recordSet=${JSON.stringify(wazeroPairs.recordSet)}, not ${JSON.stringify(recordSet)} (a stale probe artifact)`
          } (run \`go run . -spike-root ..\` in wazero-probe/ for this record set)`,
    rows: [...rows, ...wazeroRows],
    evidence,
  };
}

function k5b(differential: Artifact, wazeroReport: Artifact, recordSet: RecordSetId): ControlRow {
  const evidence = [
    { artifact: 'differential-report.json', path: 'errorRows' },
    { artifact: 'wazero-report.json', path: 'errorRows' },
  ];
  if (differential === null) {
    return {
      id: 'K5b',
      refusing: true,
      ok: null,
      detail: 'NOT MEASURED — `artifacts/differential-report.json` is absent',
      evidence,
    };
  }
  const acc = differential.errorRows;
  const controlIds: string[] = acc?.k5bControlFixtureIds ?? [];
  if (controlIds.length === 0) {
    return {
      id: 'K5b',
      refusing: true,
      ok: null,
      detail: `NOT MEASURED — this run minted no malformed-facts control bundle (record set \`${recordSet}\`; the G8 control is seed-set only)`,
      rows: [],
      evidence,
    };
  }
  const tsRows = Object.entries((acc.perArm ?? {}) as Record<string, Artifact>).map(([arm, v]) => ({
    arm,
    total: v.total,
    fromK5bControl: v.fromK5bControl,
    outsideK5b: v.outsideK5b,
    ok: v.outsideK5b === 0 && v.fromK5bControl === 1,
  }));
  // The Go half is C7's: `wazero-report.json.errorRows` in the SAME shape. Until the
  // Go arm publishes it, this is NOT MEASURED — never assumed clean.
  const goAcc = wazeroReport?.errorRows;
  const goRows = goAcc
    ? Object.entries((goAcc.perArm ?? {}) as Record<string, Artifact>).map(([arm, v]) => ({
        arm,
        total: v.total,
        fromK5bControl: v.fromK5bControl,
        outsideK5b: v.outsideK5b,
        ok: v.outsideK5b === 0 && v.fromK5bControl === 1,
      }))
    : [];
  const tsOk = tsRows.length > 0 && tsRows.every((r) => r.ok);
  const ok: Ok = !tsOk
    ? false
    : goAcc === undefined || goAcc === null
      ? null
      : goRows.every((r) => r.ok);
  return {
    id: 'K5b',
    refusing: true,
    ok,
    detail: !tsOk
      ? `an arm reported error rows outside the K5b control, or the control did not produce exactly one: ${JSON.stringify(tsRows)}`
      : goAcc
        ? `every arm (${[...tsRows, ...goRows].map((r) => r.arm).join(', ')}) reports outsideK5b=0 with exactly one control error row`
        : `the three TS arms report outsideK5b=0 with exactly one control error row; the wazero arm is NOT MEASURED — \`wazero-report.json.errorRows\` is absent (C7 is the Go leg's half of the seam)`,
    rows: [...tsRows, ...goRows],
    evidence,
  };
}

function k6(manifest: Artifact): ControlRow {
  const evidence = [
    { artifact: 'manifest.json', path: 'byteIdentity.files[]' },
    { artifact: 'manifest.json', path: 'toolchain' },
    { artifact: 'manifest.json', path: 'workingTreeClean' },
  ];
  const files = (manifest?.byteIdentity?.files ?? []) as Artifact[];
  if (files.length === 0) {
    return {
      id: 'K6',
      refusing: true,
      ok: null,
      detail: 'NOT MEASURED — the run manifest carries no `byteIdentity.files[]`',
      evidence,
    };
  }
  const unresolved = Object.entries((manifest.toolchain ?? {}) as Record<string, Artifact>)
    .filter(([, v]) => v?.version === null || v?.version === undefined)
    .map(([k]) => k);
  const bad = files.filter((r) => r.eq !== true);
  return {
    id: 'K6',
    refusing: true,
    // `ok` is the BYTE rows. The clean-tree fact is reported in `detail` and is the
    // SCORER's to refuse on — an apparatus that failed its own run over a scratch
    // file would be deciding a question that is not its.
    ok: bad.length === 0,
    detail:
      `${files.length - bad.length}/${files.length} pinned region(s) byte-identical to ${String(manifest.byteIdentity.baselinePin)}` +
      (bad.length > 0 ? ` — DELTA: ${bad.map((r) => `${r.path} (${r.region})`).join(', ')}` : '') +
      ` | toolchain: ${unresolved.length === 0 ? 'every version resolved' : `UNRESOLVED ${unresolved.join(', ')}`}` +
      ` | workingTreeClean: ${String(manifest.workingTreeClean)}`,
    rows: [
      ...files,
      { toolchainUnresolved: unresolved },
      { workingTreeClean: manifest.workingTreeClean === true },
    ],
    evidence,
  };
}

function k7(): ControlRow {
  const evidence = [
    { artifact: 'k7-rebuild/chains/*.json', path: 'regoSha256 / wasmSha256' },
    { artifact: 'chains/*.json', path: 'regoSha256 / wasmSha256' },
  ];
  const dir = path.join(K7_HOME, 'chains');
  if (!fs.existsSync(dir)) {
    return {
      id: 'K7',
      // NON-REFUSING by the charter: a cross-platform rebuild delta is a FINDING
      // about the toolchain, not an apparatus fault.
      refusing: false,
      ok: null,
      detail:
        'NOT MEASURED — `artifacts/k7-rebuild/chains/` does not exist (the Linux arm`s chains are copied there by the owner at the run of record)',
      evidence,
    };
  }
  const rows: Artifact[] = [];
  for (const name of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const rebuilt = readJson(path.join(dir, name));
    const mine = readJson(path.join(ARTIFACTS_DIR, 'chains', name));
    rows.push({
      chain: name,
      present: mine !== null,
      regoSha256Eq: mine !== null && rebuilt.regoSha256 === mine.regoSha256,
      wasmSha256Eq: mine !== null && rebuilt.wasmSha256 === mine.wasmSha256,
      ok:
        mine !== null &&
        rebuilt.regoSha256 === mine.regoSha256 &&
        rebuilt.wasmSha256 === mine.wasmSha256,
    });
  }
  const bad = rows.filter((r) => !r.ok);
  return {
    id: 'K7',
    refusing: false,
    ok: rows.length === 0 ? null : bad.length === 0,
    detail:
      rows.length === 0
        ? 'NOT MEASURED — `artifacts/k7-rebuild/chains/` is empty'
        : bad.length === 0
          ? `${rows.length} chain(s) rebuilt with identical regoSha256 AND wasmSha256`
          : `DIFFERING: ${bad.map((r) => r.chain).join(', ')}`,
    rows,
    evidence,
  };
}

async function k8(): Promise<ControlRow> {
  const evidence = K8_FIXTURES.map((f) => ({
    artifact: path.relative(SPIKE_ROOT, f.file).split(path.sep).join('/'),
    path: 'parseRuleRecord + compileRuleRecord',
  }));
  evidence.push({ artifact: 'manifest.json', path: 'controlFixtures[]' });
  const core = await loadCore();
  const rows: Artifact[] = [];
  for (const f of K8_FIXTURES) {
    if (!fs.existsSync(f.file)) {
      rows.push({
        id: f.id,
        file: path.relative(SPIKE_ROOT, f.file).split(path.sep).join('/'),
        sha256: null,
        expect: f.expect,
        kind: f.kind,
        rejected: false,
        message: 'FIXTURE ABSENT',
      });
      continue;
    }
    // The exact intake path a record takes (`src/lib/records.mts`
    // `tryCompileSpecimen`), `PINNED_NOW` included — a control that used a
    // different parser entry point would be testing a different thing.
    const specimen: Specimen = {
      id: f.id,
      class: 'compound ast-grep',
      recordFile: f.file,
      ruleId: PINNED_RULE_ID,
      legacySource: null,
      exemplarFactory: null,
      fixture: null,
      inlineFilePath: 'packages/core/src/catch-site.ts',
      notes: 'K8 control fixture — MUST be refused by the shipped § Design 5 parser.',
    };
    const outcome = tryCompileSpecimen(core, specimen);
    const message = outcome.ok ? '' : outcome.reason;
    // The charter's own predicate: the rejection MESSAGE must name the offending
    // key. A rejection for some unrelated reason would pass a bare `!ok` and prove
    // nothing about the § Design 5 clause the control is for.
    const names = f.kind === 'unknown-key' ? 'fileGlob' : 'message';
    rows.push({
      id: f.id,
      file: path.relative(SPIKE_ROOT, f.file).split(path.sep).join('/'),
      sha256: sha256(fs.readFileSync(f.file)),
      expect: f.expect,
      kind: f.kind,
      rejected: !outcome.ok,
      namesTheField: !outcome.ok && message.includes(names),
      message,
    });
  }
  const bad = rows.filter((r) => !r.rejected || r.namesTheField !== true);
  return {
    id: 'K8',
    refusing: true,
    ok: bad.length === 0,
    detail:
      bad.length === 0
        ? 'both § Design 5 fixtures are REFUSED, each with a message naming the offending field (`fileGlob`; `message`)'
        : `ACCEPTED or wrongly-reasoned: ${bad.map((r) => `${r.id} (rejected=${r.rejected})`).join('; ')} — acceptance is a control FAIL`,
    rows,
    evidence,
  };
}

async function main(): Promise<void> {
  const checks = new Checks();
  const recordSet = activeRecordSet();
  const manifest = readRunManifest();

  const lowering = artifact('lowering-rejects.json');
  const certification = artifact('certification-report.json');
  const shipped = artifact('shipped-verdicts.json');
  const differential = artifact('differential-report.json');
  const wazeroPairs = readJson(path.join(WAZERO_ARTIFACTS, 'wazero-pairs.json'));
  const wazeroReport = readJson(path.join(WAZERO_ARTIFACTS, 'wazero-report.json'));

  const controls: ControlRow[] = [
    k1(recordSet, lowering),
    k2(certification),
    k3(recordSet, manifest),
    k3b(recordSet, lowering),
    k4(),
    k5(shipped, differential, wazeroPairs, recordSet),
    k5b(differential, wazeroReport, recordSet),
    k6(manifest),
    k7(),
    await k8(),
  ];

  for (const c of controls) {
    // C6: `ok: false` on a REFUSING control is an apparatus FAIL check and the
    // stage exits 1. `ok: null` is NOT MEASURED and is recorded, never failed —
    // "the K7 rebuild has not happened yet" is not an apparatus fault.
    checks.check(
      `${c.id} — ${c.ok === null ? 'NOT MEASURED' : c.ok ? 'PASS' : 'FAIL'}${c.refusing ? '' : ' (non-refusing)'}`,
      !(c.refusing && c.ok === false),
      c.detail,
    );
  }

  const out = writeArtifact('controls.json', {
    generatedBy: 'spikes/spine-adopt/src/controls.mts',
    contract:
      'spec `.totem/specs/seed20-apparatus-slice2.md` § S7 + C6 (mmnto-ai/totem-strategy#1154 § Controls). APPARATUS ONLY: every row reports what it MEASURED and where it read it. `ok: null` is NOT MEASURED, with `detail` naming the absent input; it is never a pass. Whether a run of record may be scored on these rows is strategy`s.',
    schema: 'seed20-target.controls.v1',
    // The commit this apparatus RAN at. On the run of record it is the mailed
    // apparatus pin; before then it is whatever commit the exercise ran on, and
    // `workingTreeClean` (K6`s detail) says whether the tree matched it.
    apparatusPin: manifest.runCommit,
    runCommit: manifest.runCommit,
    recordSet,
    artifactsSubdir: ARTIFACTS_SUBDIR,
    controls,
    checks: checks.rows,
  });

  const tally = (v: Ok) => controls.filter((c) => c.ok === v).length;
  console.log(
    `\ncontrols: ${tally(true)} PASS, ${tally(false)} FAIL, ${tally(null)} NOT MEASURED -> ${out}`,
  );
  checks.finish('controls');
}

await main();
