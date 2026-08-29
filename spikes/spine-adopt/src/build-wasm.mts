// ─── Pinned `opa build -t wasm`, the determinism invariant, and the ABI census ─
//
// Binding: `rego/LOWERING.md` § Lowering 1 (one wasm bundle per record, the chain
// `sha256(record yaml) → sha256(lowered .rego + fact schema) → sha256(bundle.wasm)`)
// and § Host contract ("enumerates EVERY import the wasm instance requires — the
// OPA ABI census deliverable"). Spec § Spike 1 PASS criteria: "repeatable artifact
// hash; all imports/builtins enumerated; no network".
//
// The census is done HERE, in Node, against the module itself — imports, exports,
// ABI version globals, and the `builtins` export decoded through the module's own
// `opa_json_dump`. That is the same question the Rust host answers when
// `Runtime::new` resolves the builtin map, but measured without the host in the
// way, so a host that silently tolerated a missing builtin could not hide it.
//
// PUBLICATION (spec § Actuator slice 2, the 2026-08-28 conditional adoption word):
// this step no longer WRITES `artifacts/chains/*.json`. It still computes every
// hash in the chain — that is the determinism measurement and it belongs with the
// build — but the chain artifact IS the certificate, so it is emitted only by
// `src/certify.mts` and only on certification PASS. The computed chains are handed
// over as `artifacts/chain-inputs.json`, which is an INPUT to certification, not a
// published certificate.
//
// It does INVALIDATE, though: a rebuild makes every certificate on disk a claim
// about wasm that no longer exists, so `artifacts/chains/` and `artifacts/blocked/`
// are removed at the start of the run. Removing a stale certificate is not
// publishing one — `src/certify.mts` stays the only writer.
//
// Run: node --experimental-strip-types src/build-wasm.mts   (after src/lower.mts)

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import { activeRecordSet, loadRecordSet, type RecordRow } from './lib/record-sets.mts';
import {
  ARTIFACTS_DIR,
  Checks,
  OPA_BIN,
  readRunManifest,
  SPIKE_ROOT,
  writeArtifact,
} from './lib/spike-env.mts';
import { censusWasm, readBundleMember, readCStr, sha256 } from './lib/wasm-census.mts';

/**
 * The lowerer's own declared output, read rather than re-derived. `src/lower.mts`
 * runs a 60-check pass at import time, so importing its helpers would re-run the
 * lowering as a side effect; and re-deriving the package suffix / schema line here
 * would give the build step a SECOND opinion about what the lowerer emitted, free
 * to drift from it. Consuming the artifact makes drift impossible: if the lowering
 * has not run, this fails loud with the command to run.
 */
interface LoweringArtifact {
  factSchemaLine: string;
  lowered: {
    specimen: string;
    seedEntry: string | null;
    ruleId: string;
    package: string;
    entrypoint: string;
    engine: string;
    /** spike-relative, forward-slashed */
    dir: string;
  }[];
  /** The typed per-record reject rows (§ G3). The census evidence rows carry no `stage`. */
  rejects: { stage?: string }[];
}

function readLowering(): LoweringArtifact {
  const at = path.join(ARTIFACTS_DIR, 'lowering-rejects.json');
  if (!fs.existsSync(at)) {
    throw new Error(
      `${at} is missing — run \`node --experimental-strip-types src/lower.mts\` first.`,
    );
  }
  const a = JSON.parse(fs.readFileSync(at, 'utf-8')) as LoweringArtifact;
  if (!Array.isArray(a.lowered) || a.lowered.length === 0 || typeof a.factSchemaLine !== 'string') {
    throw new Error(`${at} does not carry the lowering index this step consumes.`);
  }
  return a;
}

/**
 * The builtins the emitter actually calls (`src/lower.mts` `emitPolicy`). Held as
 * data so the census can state, per record, which of them the HOST must supply
 * and which OPA compiled natively — the difference is the whole census.
 */
const EMITTED_BUILTINS = [
  'regex.match',
  'replace',
  'contains',
  'count',
  'is_boolean',
  'is_string',
  'is_array',
  'is_number',
] as const;

function opa(
  args: string[],
  cwd: string,
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(OPA_BIN, args, { cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// The bundle reader and the module census now live in `src/lib/wasm-census.mts`,
// shared with `src/certify.mts` so the certificate's entrypoint/import manifest
// and this artifact's ABI census are provably the SAME reading of the module.

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const checks = new Checks();
  const lowering = readLowering();
  const schemaLine = lowering.factSchemaLine;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-wasm-'));

  // ── CERTIFICATE INVALIDATION, first thing (spec § Actuator slice 2) ──
  //
  // A rebuild produces new wasm. Every certificate on disk attests the PREVIOUS
  // wasm, so from the moment this step starts they are claims about bytes that no
  // longer exist. Run standalone — `npm run build-wasm` without `npm run certify`
  // after it — leaving them in place would leave a directory of certificates that
  // certify nothing, and the only reader who could notice is the one who already
  // trusted them.
  //
  // This step still does not WRITE either directory: removing a stale certificate
  // is not publishing one, and `src/certify.mts` remains the only writer
  // (`src/certify-verify.mts` INV 8 scans for write verbs, not for this).
  for (const dir of ['chains', 'blocked']) {
    const at = path.join(ARTIFACTS_DIR, dir);
    if (fs.existsSync(at)) {
      const n = fs.readdirSync(at).length;
      fs.rmSync(at, { recursive: true, force: true });
      console.log(
        `INVALIDATED  artifacts/${dir}/ (${n} file(s) removed) — they attest the PREVIOUS wasm. ` +
          'Certificates are invalidated pending `npm run certify`.',
      );
    }
  }

  const version = opa(['version'], SPIKE_ROOT)
    .stdout.split('\n')[0]
    ?.replace(/^Version:\s*/, '')
    .trim();
  checks.eq('pinned OPA binary reports toolchain.lock [opa] version', version, '1.20.0');

  // § Lowering 2's build half, MEASURED: the flag the contract names is eval-only.
  const strictOnBuild = opa(
    ['build', '-t', 'wasm', '-e', 'x/y', '--strict-builtin-errors', 'nonexistent.rego'],
    SPIKE_ROOT,
  );
  checks.check(
    'CONTRACT MEASUREMENT — `opa build` REJECTS `--strict-builtin-errors` (§ Lowering 2 names it for build AND eval)',
    /unknown flag: --strict-builtin-errors/.test(strictOnBuild.stderr + strictOnBuild.stdout),
    (strictOnBuild.stderr + strictOnBuild.stdout).split('\n')[0] ?? '',
  );

  const chains: Record<string, unknown>[] = [];
  const censuses: Record<string, unknown>[] = [];

  // DERIVED across three independent readings: the MANIFEST says how many records
  // the run loaded, the lowering artifact says how many it REJECTED, and the index
  // says how many it lowered. A record that went missing between them is reported
  // as that, once — instead of a stale literal naming itself.
  const manifest = readRunManifest();
  const declaredRecords = (manifest.records as unknown[]).length;
  const stagedRejects = (lowering.rejects ?? []).filter((r) => typeof r.stage === 'string').length;
  const expectedLowered = declaredRecords - stagedRejects;
  checks.eq(
    `the lowering index carries all ${expectedLowered} records`,
    lowering.lowered.length,
    expectedLowered,
  );

  const recordSet = activeRecordSet();
  const rowById = new Map<string, RecordRow>(loadRecordSet(recordSet).map((r) => [r.id, r]));

  for (const row of lowering.lowered) {
    const s = rowById.get(row.specimen);
    if (!s) {
      throw new Error(
        `lowering row names record '${row.specimen}', which is not in the loaded record set (SPIKE_RECORD_SET=${recordSet}) — re-run \`npm run lower\`.`,
      );
    }
    const suffix = row.package.replace(/^totem\.spike\./, '');
    const dir = path.join(SPIKE_ROOT, ...row.dir.split('/'));
    const entrypoint = row.entrypoint;
    const regoPath = path.join(dir, 'policy.rego');
    const globsPath = path.join(dir, 'globs.json');

    // ── the determinism invariant: build TWICE, compare ──
    const outs: { tarball: string; tarSha: string; wasm: Buffer; wasmSha: string }[] = [];
    for (const n of [1, 2]) {
      const tarball = path.join(tmp, `${suffix}.${n}.tar.gz`);
      const r = opa(['build', '-t', 'wasm', '-e', entrypoint, 'policy.rego', '-o', tarball], dir);
      if (r.status !== 0) {
        throw new Error(`opa build FAILED for ${suffix}: ${r.stderr || r.stdout}`);
      }
      const wasm = readBundleMember(tarball, 'policy.wasm');
      outs.push({
        tarball,
        tarSha: sha256(fs.readFileSync(tarball)),
        wasm,
        wasmSha: sha256(wasm),
      });
    }

    const wasmIdentical = outs[0]!.wasmSha === outs[1]!.wasmSha;
    const tarballIdentical = outs[0]!.tarSha === outs[1]!.tarSha;
    checks.check(
      `${s.id} — DETERMINISM: two consecutive \`opa build\` runs give a BYTE-IDENTICAL policy.wasm`,
      wasmIdentical,
      `${outs[0]!.wasmSha.slice(0, 16)}… vs ${outs[1]!.wasmSha.slice(0, 16)}…`,
    );
    // The distinction the dispatch asks for explicitly: tarball vs inner wasm.
    checks.check(
      `${s.id} — DETERMINISM: the BUNDLE TARBALL is also byte-identical (gzip mtime is zeroed, not merely the wasm)`,
      tarballIdentical,
      tarballIdentical
        ? 'tarball and inner wasm both stable'
        : `TARBALL DIFFERS (${outs[0]!.tarSha.slice(0, 16)}… vs ${outs[1]!.tarSha.slice(0, 16)}…) while the inner wasm is ${wasmIdentical ? 'IDENTICAL — the nondeterminism is in the envelope, not the artifact' : 'ALSO different'}`,
    );

    // Publish the wasm beside its policy, per the deliverable path.
    const wasmPath = path.join(dir, 'policy.wasm');
    fs.writeFileSync(wasmPath, outs[0]!.wasm);
    const manifest = readBundleMember(outs[0]!.tarball, '.manifest');

    // ── the R2 chain ──
    const recordBytes = fs.readFileSync(s.recordFile);
    const regoBytes = fs.readFileSync(regoPath);
    const globsBytes = fs.readFileSync(globsPath);
    const components = {
      'policy.rego': sha256(regoBytes),
      'globs.json': sha256(globsBytes),
      factSchemaLine: sha256(schemaLine),
    };
    const irComposition =
      `policy.rego:${components['policy.rego']}\n` +
      `globs.json:${components['globs.json']}\n` +
      `factSchemaLine:${components.factSchemaLine}\n`;

    const chain = {
      generatedBy: 'spikes/spine-adopt/src/build-wasm.mts',
      contract:
        'rego/LOWERING.md § Lowering 1 — sha256(record yaml) → sha256(lowered .rego + fact schema) → sha256(bundle.wasm); Prop 310 Amendment R2 source→IR→artifact',
      specimen: s.id,
      // G4's seed label, on the SEED SET ONLY. The seven specimen chains are
      // published certificates whose bytes `src/certify-verify.mts` INV 2 holds to
      // byte-EQUALITY against the committed ones (their `manifestSha256` marker puts
      // that check in drift-detection mode), and the spec's constraint 3 makes those
      // bytes a refusal condition — so a new key may not appear in them.
      ...(s.seedEntry === null ? {} : { seedEntry: s.seedEntry }),
      ruleId: s.ruleId,
      package: `totem.spike.${suffix}`,
      entrypoint,
      recordSha256: sha256(recordBytes),
      recordFile: path.relative(SPIKE_ROOT, s.recordFile).split(path.sep).join('/'),
      regoSha256: sha256(irComposition),
      regoComposition: {
        note: 'sha256 over the three component digests, labelled and newline-joined in this exact order. Component digests are published so the composite is auditable without re-deriving it.',
        order: ['policy.rego', 'globs.json', 'factSchemaLine'],
        components,
        factSchemaLine: schemaLine,
        preimage: irComposition,
      },
      wasmSha256: outs[0]!.wasmSha,
      bundleTarballSha256: outs[0]!.tarSha,
      manifest: JSON.parse(manifest.toString('utf-8')),
      determinism: {
        buildCount: 2,
        wasmIdentical,
        tarballIdentical,
        wasmSha256: outs.map((o) => o.wasmSha),
        bundleTarballSha256: outs.map((o) => o.tarSha),
      },
    };
    // NOT published here (spec § Actuator slice 2): `artifacts/chains/*.json` is
    // the CERTIFICATE, and a certificate is emitted only by a certification PASS.
    // The computed chain is handed to `src/certify.mts` as an input.
    chains.push(chain);

    // ── the ABI census, per module ──
    const c = censusWasm(outs[0]!.wasm);
    const hostNames = Object.keys(c.hostBuiltins).sort();
    censuses.push({
      specimen: s.id,
      ruleId: s.ruleId,
      package: `totem.spike.${suffix}`,
      wasmBytes: outs[0]!.wasm.length,
      wasmSha256: outs[0]!.wasmSha,
      abiVersion: c.abiVersion,
      abiMinorVersion: c.abiMinorVersion,
      imports: c.imports,
      exports: c.exports,
      entrypoints: c.entrypoints,
      hostImplementedBuiltins: hostNames,
      nativelyCompiledBuiltins: EMITTED_BUILTINS.filter((b) => !hostNames.includes(b)),
    });

    checks.eq(`${s.id} — the module exposes exactly the ONE declared entrypoint`, c.entrypoints, {
      [entrypoint]: 0,
    });
    checks.eq(`${s.id} — OPA wasm ABI version`, [c.abiVersion, c.abiMinorVersion], [1, 3]);
    checks.eq(
      `${s.id} — the module requires NO host-implemented builtin (empty \`builtins\` export)`,
      hostNames,
      [],
    );
    checks.eq(
      `${s.id} — every wasm import is inside the documented OPA ABI set (no unbounded host import)`,
      c.imports.map((i) => `${i.module}.${i.name}:${i.kind}`).sort(),
      [
        'env.memory:memory',
        'env.opa_abort:function',
        'env.opa_builtin0:function',
        'env.opa_builtin1:function',
        'env.opa_builtin2:function',
        'env.opa_builtin3:function',
        'env.opa_builtin4:function',
      ],
    );
  }

  // ── the census's own falsifier ──
  //
  // "Every module needs zero host builtins" is only informative if the measurement
  // COULD have come out otherwise. Two control policies are built and censused:
  // one calling a builtin OPA does not compile into wasm, one calling only the
  // builtins the lowering actually emits.
  const controlDir = path.join(tmp, 'control');
  fs.mkdirSync(controlDir, { recursive: true });
  const controls: Record<string, unknown>[] = [];
  for (const [name, body] of [
    ['host-builtin-control', 'result := crypto.sha256(input.s)'],
    ['host-regex-find-n-control', 'result := regex.find_n("a", input.s, -1)'],
    ['emitted-builtins-control', 'result := regex.match("^a$", replace(input.s, "x", "y"))'],
  ] as const) {
    const pkg = name.replace(/-/g, '_');
    const f = path.join(controlDir, `${pkg}.rego`);
    fs.writeFileSync(f, `package ctl.${pkg}\n\n${body}\n`, 'utf-8');
    const tarball = path.join(controlDir, `${pkg}.tar.gz`);
    const r = opa(
      ['build', '-t', 'wasm', '-e', `ctl/${pkg}/result`, `${pkg}.rego`, '-o', tarball],
      controlDir,
    );
    if (r.status !== 0) throw new Error(`control build failed (${name}): ${r.stderr || r.stdout}`);
    const wasm = readBundleMember(tarball, 'policy.wasm');
    const c = censusWasm(wasm);
    controls.push({
      control: name,
      body,
      hostImplementedBuiltins: Object.keys(c.hostBuiltins).sort(),
    });
  }
  checks.check(
    'CENSUS FALSIFIER — a policy calling `crypto.sha256` DOES demand a host builtin (the empty maps above are a measurement, not a vacuous read)',
    (controls[0]!.hostImplementedBuiltins as string[]).includes('crypto.sha256'),
    JSON.stringify(controls[0]!.hostImplementedBuiltins),
  );
  checks.check(
    'CENSUS FALSIFIER — `regex.find_n` is ALSO host-demanded, so it is `regex.match` SPECIFICALLY that OPA compiles natively',
    (controls[1]!.hostImplementedBuiltins as string[]).includes('regex.find_n'),
    JSON.stringify(controls[1]!.hostImplementedBuiltins),
  );
  checks.eq(
    "CENSUS — a policy using only the lowering's own builtins demands NONE",
    controls[2]!.hostImplementedBuiltins,
    [],
  );

  // ── whose regex engine runs: wasm vs the Go binary, same policy, same input ──
  //
  // The census answer ("no host builtin") means the regex engine is INSIDE the
  // module. That makes "does it agree with the Go/RE2 engine the census measured
  // with?" an open question, so it is measured rather than assumed.
  const engineProbes: Record<string, unknown>[] = [];
  {
    const probeDir = path.join(tmp, 'engine');
    fs.mkdirSync(probeDir, { recursive: true });
    const pats: [string, string, string][] = [
      ['word-boundary', '\\bfoo\\b', 'a foo b'],
      ['word-boundary-neg', '\\bfoo\\b', 'afoob'],
      [
        'corpus-a',
        '\\b(?:git\\s+rm|rm)\\s+[^\\n]{0,40}\\.totem/lessons\\.md\\b',
        'git rm .totem/lessons.md',
      ],
      ['requires-lc-all', 'LC_ALL=C', 'LC_ALL=C git log --oneline'],
      ['glob-globstar', '^(?:[^/]+/)*[^/]*\\.sh$', 'a/b/c.sh'],
      ['glob-anchored-neg', '^[^/]*\\.ts$', 'src/a.ts'],
      ['posix-class', '^[[:alpha:]]+$', 'abc'],
      ['unicode-w', '^\\w+$', 'naive'],
      ['unicode-w-accent', '^\\w+$', 'naïve'],
    ];
    const src = [
      'package ctl.engine',
      '',
      'result := {',
      ...pats.map(
        ([k, p]) =>
          `\t${JSON.stringify(k)}: regex.match(${JSON.stringify(p)}, input[${JSON.stringify(k)}]),`,
      ),
      '}',
      '',
    ].join('\n');
    const f = path.join(probeDir, 'engine.rego');
    fs.writeFileSync(f, src, 'utf-8');
    const input: Record<string, string> = {};
    for (const [k, , s] of pats) input[k] = s;
    fs.writeFileSync(path.join(probeDir, 'input.json'), JSON.stringify(input), 'utf-8');

    const tarball = path.join(probeDir, 'engine.tar.gz');
    const b = opa(
      ['build', '-t', 'wasm', '-e', 'ctl/engine/result', 'engine.rego', '-o', tarball],
      probeDir,
    );
    if (b.status !== 0) throw new Error(`engine probe build failed: ${b.stderr || b.stdout}`);
    const wasm = readBundleMember(tarball, 'policy.wasm');
    const wasmResult = evalWasm(wasm, 'ctl/engine/result', input);

    const goRun = opa(
      [
        'eval',
        '--format=json',
        '--strict-builtin-errors',
        '-d',
        'engine.rego',
        '-i',
        'input.json',
        'data.ctl.engine.result',
      ],
      probeDir,
    );
    // Every other `opa` call site in this file guards on `status` first. Without
    // it a non-zero exit yields `stdout === ''`, `JSON.parse` throws
    // "Unexpected end of JSON input", and OPA's real diagnostic — which is on
    // stderr — is never printed. Same for a body that binds nothing: `.result`
    // is absent and the property chain throws a TypeError instead of naming the
    // problem.
    if (goRun.status !== 0) {
      throw new Error(`engine probe \`opa eval\` failed: ${goRun.stderr || goRun.stdout}`);
    }
    const goRows = JSON.parse(goRun.stdout).result as
      | { expressions: { value: Record<string, boolean> }[] }[]
      | undefined;
    if (!Array.isArray(goRows) || goRows.length !== 1) {
      throw new Error(`engine probe \`opa eval\` returned no single result: ${goRun.stdout}`);
    }
    const goResult = goRows[0]!.expressions[0]!.value;

    for (const [k] of pats) {
      engineProbes.push({
        probe: k,
        wasm: wasmResult[k],
        go: goResult[k],
        agree: wasmResult[k] === goResult[k],
      });
    }
    checks.check(
      'ENGINE — the wasm-native regex engine agrees with the Go/RE2 binary on every discriminating probe',
      engineProbes.every((p) => p.agree),
      `${engineProbes.filter((p) => p.agree).length}/${engineProbes.length} agree`,
    );
    checks.check(
      'ENGINE — the probe set is DISCRIMINATING (it contains both a true and a false)',
      engineProbes.some((p) => p.wasm === true) && engineProbes.some((p) => p.wasm === false),
      JSON.stringify(wasmResult),
    );
  }

  // ── the wasm's behaviour on an INEXPRESSIBLE pattern, measured ──
  //
  // This is the finding that forced § Lowering 2's strictness to be structural.
  const failOpen = (() => {
    const d = path.join(tmp, 'failopen');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(
      path.join(d, 'fo.rego'),
      'package ctl.fo\n\nresult := regex.match("foo(?!bar)", input.s)\n',
      'utf-8',
    );
    fs.writeFileSync(path.join(d, 'input.json'), JSON.stringify({ s: 'foobaz' }), 'utf-8');
    const b = opa(['build', '-t', 'wasm', '-e', 'ctl/fo/result', 'fo.rego', '-o', 'fo.tar.gz'], d);
    const built = b.status === 0;
    let wasmOutcome = '(not built)';
    let raw: unknown = null;
    if (built) {
      const wasm = readBundleMember(path.join(d, 'fo.tar.gz'), 'policy.wasm');
      try {
        raw = evalWasmRaw(wasm, 'ctl/fo/result', { s: 'foobaz' });
        wasmOutcome =
          Array.isArray(raw) && raw.length === 0
            ? 'EMPTY RESULT SET (silent, no trap, no opa_abort)'
            : `result: ${JSON.stringify(raw)}`;
      } catch (err) {
        wasmOutcome = `TRAPPED: ${(err as Error).message}`;
      }
    }
    const goStrict = opa(
      [
        'eval',
        '--format=json',
        '--strict-builtin-errors',
        '-d',
        'fo.rego',
        '-i',
        'input.json',
        'data.ctl.fo.result',
      ],
      d,
    );
    return {
      built,
      buildExit: b.status,
      wasmOutcome,
      wasmRaw: raw,
      goStrictExit: goStrict.status,
      goStrictStdout: goStrict.stdout.trim().slice(0, 400),
    };
  })();

  checks.check(
    'STRICTNESS — `opa build -t wasm` ACCEPTS an RE2-inexpressible pattern (the failure is deferred to eval)',
    failOpen.built,
    `build exit=${failOpen.buildExit}`,
  );
  checks.check(
    'STRICTNESS — the wasm module then FAILS OPEN at eval: an empty result set, no trap, no `opa_abort`',
    failOpen.wasmOutcome.startsWith('EMPTY RESULT SET'),
    failOpen.wasmOutcome,
  );
  checks.check(
    'STRICTNESS — the SAME policy under `opa eval --strict-builtin-errors` exits NON-ZERO with a compile error',
    failOpen.goStrictExit !== 0,
    `exit=${failOpen.goStrictExit}`,
  );

  // The structural mitigation, PROVEN rather than asserted: the same bad pattern
  // wrapped in the lowering's `patterns_compile` guard still yields an empty
  // result set — which is exactly why the host must read that as an ERROR.
  const guarded = (() => {
    const d = path.join(tmp, 'guarded');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(
      path.join(d, 'g.rego'),
      [
        'package ctl.g',
        '',
        'patterns_compile if {',
        '\tis_boolean(regex.match("foo(?!bar)", ""))',
        '}',
        '',
        'violations contains v if {',
        '\tregex.match("foo(?!bar)", input.s)',
        '\tv := {"line_number": 1}',
        '}',
        '',
        'result := {"violations": violations} if {',
        '\tpatterns_compile',
        '}',
        '',
      ].join('\n'),
      'utf-8',
    );
    const b = opa(['build', '-t', 'wasm', '-e', 'ctl/g/result', 'g.rego', '-o', 'g.tar.gz'], d);
    if (b.status !== 0) throw new Error(`guarded control build failed: ${b.stderr || b.stdout}`);
    const wasm = readBundleMember(path.join(d, 'g.tar.gz'), 'policy.wasm');
    return evalWasmRaw(wasm, 'ctl/g/result', { s: 'foobaz' });
  })();
  checks.check(
    "STRICTNESS — the lowering's `patterns_compile` guard turns that fail-open into an UNDEFINED `result` (empty result SET), which the host contract raises as an error row",
    Array.isArray(guarded) && guarded.length === 0,
    JSON.stringify(guarded),
  );

  // ── the aggregate census artifact ──
  const allImports = new Set<string>();
  const allHostBuiltins = new Set<string>();
  for (const c of censuses) {
    for (const i of c.imports as { module: string; name: string; kind: string }[]) {
      allImports.add(`${i.module}.${i.name}:${i.kind}`);
    }
    for (const b of c.hostImplementedBuiltins as string[]) allHostBuiltins.add(b);
  }

  writeArtifact('opa-abi-census.json', {
    generatedBy: 'spikes/spine-adopt/src/build-wasm.mts',
    contract:
      'rego/LOWERING.md § Host contract ("enumerates EVERY import the wasm instance requires") + spec § Spike 1 ("all imports/builtins enumerated"; "Census required builtins and OPA ABI imports BEFORE choosing the host path")',
    opaVersion: version,
    headline: {
      [`hostImplementedBuiltinsAcrossAll${censuses.length}`]: [...allHostBuiltins].sort(),
      [`distinctImportsAcrossAll${censuses.length}`]: [...allImports].sort(),
      finding: `ZERO host-implemented builtins across all ${censuses.length} policies. \`regex.match\` — the builtin that decides every verdict in this spike — is COMPILED NATIVELY INTO THE WASM by \`opa build\`, not delegated to the host. The regex engine that actually runs is OPA's own wasm-compiled engine; neither the host language's regex crate nor the Go RE2 binary is in the evaluation path. Measured to agree with the Go binary on every discriminating probe (see \`engineProbes\`), and the empty map is falsified by controls that DO demand \`crypto.sha256\` / \`regex.find_n\`.`,
      hostPathConsequence:
        'The host never needs builtin injection for these policies, so `rust-opa-wasm`\'s fixed `builtins::resolve` table — which has no public extension point — is not a constraint here. It WOULD be for any policy using a builtin outside that table, and `regex.find_n` is the sharp case: it IS in the crate\'s table but its body is `bail!("not implemented")`, so such a policy loads fine and fails at CALL time.',
      importSetVerdict: `Every import is inside the documented OPA ABI set (env.memory + opa_abort + opa_builtin0..4). No unbounded host import. \`env.opa_println\` is NOT imported by any of the ${censuses.length} modules, so a host that defines it simply goes unused.`,
    },
    emittedBuiltins: EMITTED_BUILTINS,
    perRecord: censuses,
    controls,
    engineProbes,
    strictness: {
      contractClause:
        '§ Lowering 2: "`opa build` and every `opa eval` run with `--strict-builtin-errors`; the host must surface builtin errors as errors."',
      buildFlagMeasurement:
        '`opa build` REJECTS `--strict-builtin-errors` — "unknown flag". It is an `eval`-only flag, so the build half of § Lowering 2 is not satisfiable as written against pinned OPA v1.20.0.',
      wasmMeasurement: failOpen,
      structuralMitigation:
        'The lowering makes strictness structural instead: every emitted pattern is exercised by `patterns_compile` inside the COMPLETE `result` rule, so a compile failure leaves `result` undefined and the entrypoint returns an EMPTY RESULT SET. Proven on a control (see `guardedControlResult`). The host contract then requires reading an empty result set as an ERROR ROW, never as a zero-violation verdict.',
      guardedControlResult: guarded,
    },
    chains: chains.map((c) => ({
      specimen: c.specimen,
      ruleId: c.ruleId,
      recordSha256: c.recordSha256,
      regoSha256: c.regoSha256,
      wasmSha256: c.wasmSha256,
      determinism: c.determinism,
    })),
    checks: checks.rows,
  });

  // ── the chain HAND-OFF (spec § Actuator slice 2) ──
  //
  // Every hash in the certificate is computed here, with the build that produced
  // the artifact; nothing is published. `src/certify.mts` reads this, evaluates
  // each bundle's entrypoints against the sentinel FactBundle, and writes
  // `artifacts/chains/<pkg>.json` only for the bundles that certify PASS.
  writeArtifact('chain-inputs.json', {
    generatedBy: 'spikes/spine-adopt/src/build-wasm.mts',
    contract:
      'spec § Actuator slice 2 — "the chain artifact IS the certificate; `certify` gates chain emission". This file is the UNPUBLISHED input to that gate, never a certificate.',
    publishedBy: 'spikes/spine-adopt/src/certify.mts (on certification PASS only)',
    chains,
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${chains.length} chains computed -> artifacts/chain-inputs.json (UNPUBLISHED)`);
  console.log('   publication is gated on `npm run certify` (spec § Actuator slice 2)');
  checks.finish('build-wasm');
}

// ─── A minimal OPA-ABI evaluator, for the census probes only ─────────────────
//
// Deliberately NOT the differential arm: the arms are the Rust host (rust-opa-wasm
// on wasmtime) and regorus, per § Host contract. This exists so the census can
// answer "what does the MODULE do" without the host in the way.

function evalWasmRaw(bytes: Buffer, entrypoint: string, input: unknown): unknown {
  const mod = new WebAssembly.Module(bytes);
  const memory = new WebAssembly.Memory({ initial: 32 });
  const inst = new WebAssembly.Instance(mod, {
    env: {
      memory,
      opa_abort: (a: number) => {
        throw new Error(`opa_abort: ${readCStr(memory, a)}`);
      },
      opa_println: () => {},
      opa_builtin0: () => {
        throw new Error('unexpected host builtin call (arity 0)');
      },
      opa_builtin1: () => {
        throw new Error('unexpected host builtin call (arity 1)');
      },
      opa_builtin2: () => {
        throw new Error('unexpected host builtin call (arity 2)');
      },
      opa_builtin3: () => {
        throw new Error('unexpected host builtin call (arity 3)');
      },
      opa_builtin4: () => {
        throw new Error('unexpected host builtin call (arity 4)');
      },
    },
  });
  const x = inst.exports as Record<string, any>;
  const write = (s: string): [number, number] => {
    const buf = new TextEncoder().encode(s);
    const p = x.opa_malloc(buf.length);
    new Uint8Array(memory.buffer).set(buf, p);
    return [p, buf.length];
  };
  const eps = JSON.parse(readCStr(memory, x.opa_json_dump(x.entrypoints()))) as Record<
    string,
    number
  >;
  const epId = eps[entrypoint];
  if (epId === undefined) throw new Error(`no entrypoint ${entrypoint} in ${JSON.stringify(eps)}`);
  const [dp, dl] = write('{}');
  const data = x.opa_json_parse(dp, dl);
  const [ip, il] = write(JSON.stringify(input));
  const inputAddr = x.opa_json_parse(ip, il);
  const ctx = x.opa_eval_ctx_new();
  x.opa_eval_ctx_set_data(ctx, data);
  x.opa_eval_ctx_set_input(ctx, inputAddr);
  x.opa_eval_ctx_set_entrypoint(ctx, epId);
  x.eval(ctx);
  return JSON.parse(readCStr(memory, x.opa_json_dump(x.opa_eval_ctx_get_result(ctx))));
}

function evalWasm(bytes: Buffer, entrypoint: string, input: unknown): Record<string, boolean> {
  const raw = evalWasmRaw(bytes, entrypoint, input) as { result: Record<string, boolean> }[];
  if (!Array.isArray(raw) || raw.length !== 1) {
    throw new Error(
      `entrypoint ${entrypoint} returned ${JSON.stringify(raw)} — expected one result`,
    );
  }
  return raw[0]!.result;
}

await main();
