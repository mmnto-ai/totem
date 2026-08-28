// ─── The certification actuator ──────────────────────────────────────────────
//
// BINDING CONTRACT — `.totem/specs/spine-spike.md` § "Actuator slice (slice 1 —
// BINDING condition 1 of the 2026-08-28 conditional adoption word)", verbatim:
//
//   certification evaluates EVERY emitted entrypoint against a schema-valid
//   sentinel FactBundle BEFORE artifact publication; empty / undefined / error /
//   non-object / missing result keys BLOCK the artifact and its certificate; the
//   guard lives in the only exported result path; every host retains the failure
//   rule; negative conformance fixtures exercise unsupported patterns on all
//   hosts; the certificate chain binds source · IR · guarded policy ·
//   entrypoint/import manifest · final Wasm hash.
//
// What this file does, clause by clause:
//
//   (a) enumerates entrypoints / imports / builtins from each built bundle, using
//       the SAME census code path as the ABI census deliverable
//       (`src/lib/wasm-census.mts`);
//   (b) asserts the only-exported-result-path invariant — exactly one
//       `<pkg>/result` entrypoint (§ Actuator slice 4);
//   (c) evaluates EVERY declared entrypoint against the sentinel through the
//       wasmtime host (`host --arm certify`), with regorus alongside;
//   (d) classifies each evaluation PASS or BLOCKED-with-a-typed-reason, one of
//       the five ruled classes;
//   (e) PUBLISHES: `artifacts/chains/<pkg>.json` is written ONLY on PASS, with
//       the entrypoint/import manifest hash joined to the bound set; a blocked
//       bundle gets `artifacts/blocked/<pkg>.json` and NO chain;
//   (f) REFUSES a schema-invalid sentinel before any evaluation happens at all.
//
// The negative conformance fixtures (`rego/certify-fixtures/`) are driven through
// all three hosts here — wasmtime, regorus, wazero — because "every host retains
// the failure rule" is a claim about hosts, and a claim about hosts is only
// evidence when each host is actually asked.
//
// Determinism: no timestamps, no run ids, no wall-clock anywhere in any artifact.
//
// Run: node --experimental-strip-types src/certify.mts
//      (after src/lower.mts and src/build-wasm.mts; `npm run certify` chains it
//       with src/certify-verify.mts, which asserts the ruled invariants)

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  ARTIFACTS_DIR,
  Checks,
  OPA_BIN,
  REPO_ROOT,
  SPIKE_ROOT,
  writeArtifact,
} from './lib/spike-env.mts';
import {
  canonicalJson,
  censusWasm,
  entrypointManifest,
  readBundleMember,
  sha256,
  type EntrypointManifest,
  type WasmCensus,
} from './lib/wasm-census.mts';

const REGO_BUILD_DIR = path.join(SPIKE_ROOT, 'rego', 'build');
const FIXTURES_DIR = path.join(SPIKE_ROOT, 'rego', 'certify-fixtures');
const FIXTURE_BUILD_DIR = path.join(FIXTURES_DIR, 'build');
const CHAINS_DIR = path.join(ARTIFACTS_DIR, 'chains');
const BLOCKED_DIR = path.join(ARTIFACTS_DIR, 'blocked');

// ─── The sentinel (spec § Actuator slice 1) ──────────────────────────────────

/**
 * "schema-valid and neutral: a CORRECT policy yields a defined object with
 * exactly the keys `violations` + `events` (both empty sets); a policy whose
 * `patterns_compile` probe fails yields an UNDEFINED result (empty eval result
 * set)."
 *
 * Neutrality is what makes the discriminator sharp. With no lines and no ast
 * matches, no policy can produce a violation for a reason of its own, so the only
 * thing that varies across bundles is whether the guarded `result` rule is
 * DEFINED — which is exactly the property under certification.
 */
export const SENTINEL = {
  file: 'certify/sentinel.ts',
  fileText: '',
  lines: [] as string[],
  astMatches: [] as unknown[],
};

/**
 * The malformed control (§ Actuator slice 5's "A malformed-sentinel control
 * (schema-invalid bundle) must be refused by the certifier itself before any
 * eval"). Every field is wrong in a different way, so the refusal cannot rest on
 * one lucky check.
 */
export const MALFORMED_SENTINEL = {
  file: 42,
  fileText: [],
  lines: ['ok', 7, null],
  astMatches: 'not-an-array',
  surprise: true,
};

// ─── (f) The FactBundle schema validator ─────────────────────────────────────

/**
 * Validate against the FactBundle shape LOWERING.md § Input contract states:
 *
 *   input = { file, fileText: string|null, lines: [string],
 *             astMatches: [{lineNumber, lineText, startLineText,
 *                           startPrecedingLineText}] }
 *
 * Exact key sets, both at the top level and per ast match: the schema line is a
 * closed description, and an unrecognised key in a bundle handed to a policy is
 * a bundle the policy was not written against. Returns the list of violations —
 * EMPTY means valid.
 *
 * Not vacuously strict: `main` runs it over all 24 measured fact bundles and
 * asserts every one is accepted, so a validator that rejected everything could
 * not pass this run.
 */
export function validateFactBundle(v: unknown): string[] {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return [`the FactBundle is not a JSON object (got ${v === null ? 'null' : typeof v})`];
  }
  const errs: string[] = [];
  const b = v as Record<string, unknown>;
  const required = ['file', 'fileText', 'lines', 'astMatches'];
  for (const k of required) if (!(k in b)) errs.push(`missing required key \`${k}\``);
  const extra = Object.keys(b)
    .filter((k) => !required.includes(k))
    .sort();
  if (extra.length > 0) {
    errs.push(
      `unknown key(s) ${extra.map((k) => `\`${k}\``).join(', ')} — the schema line is exact`,
    );
  }

  if ('file' in b && typeof b.file !== 'string') {
    errs.push(`\`file\` must be a string (got ${typeName(b.file)})`);
  }
  if ('fileText' in b && !(b.fileText === null || typeof b.fileText === 'string')) {
    errs.push(`\`fileText\` must be a string or null (got ${typeName(b.fileText)})`);
  }
  if ('lines' in b) {
    if (!Array.isArray(b.lines)) {
      errs.push(`\`lines\` must be an array (got ${typeName(b.lines)})`);
    } else {
      b.lines.forEach((l, i) => {
        if (typeof l !== 'string')
          errs.push(`\`lines[${i}]\` must be a string (got ${typeName(l)})`);
      });
    }
  }
  if ('astMatches' in b) {
    if (!Array.isArray(b.astMatches)) {
      errs.push(`\`astMatches\` must be an array (got ${typeName(b.astMatches)})`);
    } else {
      b.astMatches.forEach((m, i) => errs.push(...validateAstMatch(m, i)));
    }
  }
  return errs;
}

function validateAstMatch(m: unknown, i: number): string[] {
  if (m === null || typeof m !== 'object' || Array.isArray(m)) {
    return [`\`astMatches[${i}]\` must be an object (got ${typeName(m)})`];
  }
  const errs: string[] = [];
  const o = m as Record<string, unknown>;
  const required = ['lineNumber', 'lineText', 'startLineText', 'startPrecedingLineText'];
  for (const k of ['lineNumber', 'lineText', 'startLineText']) {
    if (!(k in o)) errs.push(`\`astMatches[${i}].${k}\` is missing`);
  }
  const extra = Object.keys(o)
    .filter((k) => !required.includes(k))
    .sort();
  if (extra.length > 0) {
    errs.push(
      `\`astMatches[${i}]\` carries unknown key(s) ${extra.map((k) => `\`${k}\``).join(', ')}`,
    );
  }
  if ('lineNumber' in o && typeof o.lineNumber !== 'number') {
    errs.push(`\`astMatches[${i}].lineNumber\` must be a number (got ${typeName(o.lineNumber)})`);
  }
  for (const k of ['lineText', 'startLineText']) {
    if (k in o && typeof o[k] !== 'string') {
      errs.push(`\`astMatches[${i}].${k}\` must be a string (got ${typeName(o[k])})`);
    }
  }
  // `startPrecedingLineText` is absent for a match on line 1 and null when the
  // extractor read no preceding line — measured across all 24 bundles.
  if (
    'startPrecedingLineText' in o &&
    !(o.startPrecedingLineText === null || typeof o.startPrecedingLineText === 'string')
  ) {
    errs.push(
      `\`astMatches[${i}].startPrecedingLineText\` must be a string or null (got ${typeName(o.startPrecedingLineText)})`,
    );
  }
  return errs;
}

function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

// ─── (d) The classifier ──────────────────────────────────────────────────────

/**
 * The five typed blocked reasons, verbatim from the ruled discriminator:
 * "well-formed-object vs {empty result set, eval error/trap, non-object, missing
 * keys} — five blocked classes, each a typed reason."
 */
export const BLOCKED_REASONS = [
  'empty-result-set',
  'eval-error-or-trap',
  'non-object',
  'missing-keys',
  'extra-or-malformed-keys',
] as const;
export type BlockedReason = (typeof BLOCKED_REASONS)[number];

/**
 * The HOST's own verdict on one evaluation — `failure_rule_verdict` in
 * `host/src/main.rs`, computed by running that host's normal-arm chain
 * (`entrypoint_value` → `read_result`, or regorus's undefined/non-object
 * rejection → `read_result`).
 *
 * This is what "every host retains the failure rule" is EVIDENCE of: the rule ran
 * inside the host and its error string is the host's own. The certifier reads it;
 * it never reconstructs it from the raw shape and then calls that the host's rule.
 */
export interface FailureRuleVerdict {
  ok: boolean;
  error: string | null;
  violations: number | null;
  events: number | null;
}

export interface HostEvaluation {
  entrypoint: string;
  ok: boolean;
  error: string | null;
  resultSet: unknown;
  resultSetIsArray: boolean | null;
  resultSetLength: number | null;
  result: unknown;
  /** Absent only on the constructed classifier unit-control rows, which have no host. */
  failureRuleVerdict?: FailureRuleVerdict;
}

export interface Classification {
  entrypoint: string;
  status: 'PASS' | 'BLOCKED';
  reason: BlockedReason | null;
  detail: string;
}

/**
 * PASS is "a defined object with exactly the keys `violations` + `events`", both
 * arrays. Everything else is one of the five typed reasons.
 *
 * The order of the tests is the order of the ruled enumeration and is
 * load-bearing: a result that is BOTH missing `events` and carrying a surplus key
 * is reported as `missing-keys`, because the absent key is the stronger claim
 * ("absent = absent": a lowering that stopped emitting `events` must never read
 * as a record that emits none).
 */
export function classifyEvaluation(ev: HostEvaluation): Classification {
  const at = (status: 'PASS' | 'BLOCKED', reason: BlockedReason | null, detail: string) => ({
    entrypoint: ev.entrypoint,
    status,
    reason,
    detail,
  });

  if (!ev.ok || ev.error !== null) {
    return at('BLOCKED', 'eval-error-or-trap', firstLine(ev.error ?? 'evaluation reported not-ok'));
  }
  if (ev.resultSetIsArray !== true) {
    return at(
      'BLOCKED',
      'eval-error-or-trap',
      `the entrypoint returned a NON-ARRAY result set (${typeName(ev.resultSet)}) — an ABI-level protocol failure`,
    );
  }
  if (ev.resultSetLength === 0) {
    return at(
      'BLOCKED',
      'empty-result-set',
      'the entrypoint returned an EMPTY RESULT SET — the guarded `result` rule was UNDEFINED (`patterns_compile` or `facts_wellformed` failed). Never a zero-violation verdict.',
    );
  }
  if (ev.resultSetLength !== 1) {
    return at(
      'BLOCKED',
      'eval-error-or-trap',
      `the result set carried ${ev.resultSetLength} entries; the protocol emits exactly one`,
    );
  }
  // BOTH encodings of "no `result` key", because the wire format has two. The
  // wasmtime arm builds this field with `a[0].get("result").cloned()`, an
  // `Option<Value>` that serde serialises as JSON `null` when the key is absent —
  // so the key is ALWAYS present on the JS side and `undefined` never arrives.
  // Testing only for `undefined` left a dead branch and let a missing key fall
  // through to the `non-object` classification, which names the wrong defect.
  if (ev.result === undefined || ev.result === null) {
    return at(
      'BLOCKED',
      'eval-error-or-trap',
      `the result-set entry carries no usable \`result\` (${ev.result === undefined ? 'the key is absent from the host row' : 'the host encodes an absent `result` key as JSON `null` — serde `Option<Value>` → null'})`,
    );
  }
  if (ev.result === null || typeof ev.result !== 'object' || Array.isArray(ev.result)) {
    return at(
      'BLOCKED',
      'non-object',
      `the result is ${typeName(ev.result)}, not an object: ${JSON.stringify(ev.result).slice(0, 120)}`,
    );
  }

  const r = ev.result as Record<string, unknown>;
  const keys = Object.keys(r).sort();
  const missing = ['violations', 'events'].filter((k) => !(k in r));
  if (missing.length > 0) {
    return at(
      'BLOCKED',
      'missing-keys',
      `the result is missing ${missing.map((k) => `\`${k}\``).join(' and ')} (has ${keys.map((k) => `\`${k}\``).join(', ') || 'no keys'})`,
    );
  }
  const surplus = keys.filter((k) => k !== 'violations' && k !== 'events');
  if (surplus.length > 0) {
    return at(
      'BLOCKED',
      'extra-or-malformed-keys',
      `the result carries surplus key(s) ${surplus.map((k) => `\`${k}\``).join(', ')} — PASS is EXACTLY \`violations\` + \`events\``,
    );
  }
  const badTypes = ['violations', 'events'].filter((k) => !Array.isArray(r[k]));
  if (badTypes.length > 0) {
    return at(
      'BLOCKED',
      'extra-or-malformed-keys',
      `${badTypes.map((k) => `\`${k}\``).join(' and ')} ${badTypes.length === 1 ? 'is' : 'are'} not an array (${badTypes.map((k) => typeName(r[k])).join(', ')})`,
    );
  }
  return at(
    'PASS',
    null,
    `defined object with exactly \`violations\` + \`events\` (${(r.violations as unknown[]).length} violations, ${(r.events as unknown[]).length} events)`,
  );
}

function firstLine(s: string): string {
  return s.split('\n')[0]!.trim();
}

/**
 * Is this host's parsed result the well-formed ZERO verdict — exactly
 * `violations` + `events`, both empty?
 *
 * Compared STRUCTURALLY, never against a serialised literal. The three hosts do
 * not agree on key order: `serde_json`'s default map is a `BTreeMap`, so the two
 * Rust arms emit `{"events":…,"violations":…}` (sorted), while the Go probe
 * marshals a STRUCT and emits `{"violations":…,"events":…}` (declaration order).
 * A string comparison therefore answers a question about serialisation instead
 * of a question about the verdict, and silently reports `false` for a genuine
 * clean zero on whichever host lost the coin toss.
 *
 * This matters because every `required` row asserts `!cleanZero`. A predicate
 * that could never return `true` would satisfy that vacuously, which is why the
 * positive control below asserts the other side.
 */
function isCleanZero(v: unknown): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return (
    keys.length === 2 &&
    keys[0] === 'events' &&
    keys[1] === 'violations' &&
    Array.isArray(o.violations) &&
    o.violations.length === 0 &&
    Array.isArray(o.events) &&
    o.events.length === 0
  );
}

// ─── Host drivers ────────────────────────────────────────────────────────────

/**
 * How many times the wasmtime host has actually been invoked. The malformed
 * sentinel control asserts this does not move — "refused by the certifier itself
 * BEFORE any eval" is a claim about ORDER, and a counter is the only way to
 * observe order rather than assert it.
 */
let hostEvalInvocations = 0;

export function hostEvalCount(): number {
  return hostEvalInvocations;
}

const HOST_BIN = path.join(
  SPIKE_ROOT,
  'host',
  'target',
  'release',
  process.platform === 'win32' ? 'spine-host.exe' : 'spine-host',
);

function buildHost(): void {
  const r = spawnSync(
    'cargo',
    ['build', '--release', '--manifest-path', path.join(SPIKE_ROOT, 'host', 'Cargo.toml')],
    { cwd: SPIKE_ROOT, encoding: 'utf-8', stdio: ['ignore', 'inherit', 'inherit'] },
  );
  if (r.status !== 0) {
    throw new Error(
      `cargo build of the spike host failed (exit ${r.status}) — certification cannot run`,
    );
  }
  if (!fs.existsSync(HOST_BIN)) {
    throw new Error(
      `the spike host binary is missing at ${HOST_BIN} after a successful cargo build`,
    );
  }
}

interface HostCertifyResult {
  wasmSha256: string;
  wasmtime: {
    loaded: boolean;
    loadError: string | null;
    abiVersion?: string;
    imports?: string[];
    declaredEntrypoints?: string[];
    evaluatedEntrypoints?: string[];
    evaluations: HostEvaluation[];
  };
  regorus: {
    ran: boolean;
    rule?: string;
    ok?: boolean;
    undefined?: boolean | null;
    value?: unknown;
    error?: string | null;
    failureRuleVerdict?: FailureRuleVerdict;
  };
}

function hostCertify(
  wasmPath: string,
  inputPath: string,
  entrypoints: string[],
  rego?: { regoPath: string; rule: string },
): HostCertifyResult {
  hostEvalInvocations += 1;
  const args = ['--arm', 'certify', '--wasm', wasmPath, '--input', inputPath];
  for (const e of entrypoints) args.push('--entrypoint', e);
  if (rego) {
    // regorus quotes this label in its own error text, and the certifier copies
    // that text VERBATIM into `artifacts/blocked/<pkg>.json` and the
    // certification report. Handing the host the absolute path would publish the
    // operator's worktree layout as committed evidence and break byte-comparison
    // between the Windows and Linux matrix arms. The host still READS the policy
    // from `--rego`; only the printed name is normalised.
    const regoLabel = path.relative(REPO_ROOT, rego.regoPath).split(path.sep).join('/');
    args.push('--rego', rego.regoPath, '--rego-label', regoLabel, '--rule', rego.rule);
  }
  const r = spawnSync(HOST_BIN, args, {
    cwd: SPIKE_ROOT,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(
      `host --arm certify exited ${r.status} for ${wasmPath}: ${(r.stderr || r.stdout || '').slice(0, 800)}`,
    );
  }
  try {
    return JSON.parse(r.stdout) as HostCertifyResult;
  } catch {
    throw new Error(
      `host --arm certify emitted unparseable stdout for ${wasmPath}: ${r.stdout.slice(0, 400)}`,
    );
  }
}

/** The wazero arm, driven through the probe's own `-conformance` mode. */
interface WazeroRow {
  id: string;
  wasmSha256: string;
  loaded: boolean;
  loadError: string | null;
  declaredEntrypoints: string[] | null;
  requiredBuiltins: Record<string, number> | null;
  evaluations: {
    entrypoint: string;
    ok: boolean;
    error: string | null;
    resultSetLength: number | null;
    result: unknown;
  }[];
}

function wazeroConformance(
  cases: { id: string; wasm: string; entrypoints: string[] }[],
  input: unknown,
  tmp: string,
): WazeroRow[] {
  const specPath = path.join(tmp, 'wazero-conformance-spec.json');
  const outPath = path.join(tmp, 'wazero-conformance-rows.json');
  fs.writeFileSync(
    specPath,
    `${JSON.stringify({ cases: cases.map((c) => ({ ...c, input })) }, null, 2)}\n`,
    'utf-8',
  );
  const probeDir = path.join(SPIKE_ROOT, 'wazero-probe');
  const r = spawnSync('go', ['run', '.', '-conformance', specPath, '-conformance-out', outPath], {
    cwd: probeDir,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    // A missing/broken Go toolchain is a HARD failure, never a skip: "every host
    // retains the failure rule" is unverified if a host was never asked, and a
    // silently-skipped arm is precisely the shape this spike exists to refuse
    // (Tenet 4 — no silent-degradation rows).
    throw new Error(
      `the wazero conformance arm failed (exit ${r.status}). It is REQUIRED — the ruled text says every host retains the failure rule, so a skipped host is an unproven claim. Install Go (see wazero-probe/go.mod) and re-run.\n${(r.stderr || r.stdout || '').slice(0, 1200)}`,
    );
  }
  return (JSON.parse(fs.readFileSync(outPath, 'utf-8')) as { rows: WazeroRow[] }).rows;
}

// ─── Bundle certification ────────────────────────────────────────────────────

export interface CertificationRow {
  id: string;
  kind: 'specimen' | 'negative-fixture' | 'classifier-control' | 'entrypoint-control';
  package: string;
  expectedEntrypoint: string;
  wasmSha256: string;
  /** false ⇒ the run was refused before the module was ever touched (clause f). */
  evaluated: boolean;
  sentinelValid: boolean;
  sentinelSchemaErrors: string[];
  manifest: EntrypointManifest | null;
  manifestSha256: string | null;
  entrypointAssertion: { ok: boolean; detail: string } | null;
  classifications: Classification[];
  /** The overall verdict for the BUNDLE. */
  status: 'PASS' | 'BLOCKED';
  /**
   * The typed reason. One of the five result classes, or a pre-eval refusal —
   * the entrypoint-set assertion (§ Actuator slice 4) and the schema-invalid
   * sentinel (§ Actuator slice 5) are separate gates, not result classes, and are
   * typed as such rather than squeezed into the five.
   */
  reason: BlockedReason | 'entrypoint-set-not-single-result' | 'schema-invalid-sentinel' | null;
  detail: string;
  chainWritten: string | null;
  blockedArtifact: string | null;
}

interface CertifyOptions {
  id: string;
  kind: CertificationRow['kind'];
  packageName: string;
  expectedEntrypoint: string;
  wasmPath: string;
  regoPath: string;
  sentinel: unknown;
  sentinelPathFor: (v: unknown) => string;
  /** Present for the 7 specimens: the computed, unpublished chain to extend and publish on PASS. */
  chainInput?: Record<string, unknown>;
  chainFileName?: string;
}

function certifyBundle(o: CertifyOptions): {
  row: CertificationRow;
  host: HostCertifyResult | null;
} {
  // ── (f) FIRST, before the module is opened at all ──
  const schemaErrors = validateFactBundle(o.sentinel);
  const base: CertificationRow = {
    id: o.id,
    kind: o.kind,
    package: o.packageName,
    expectedEntrypoint: o.expectedEntrypoint,
    wasmSha256: '',
    evaluated: false,
    sentinelValid: schemaErrors.length === 0,
    sentinelSchemaErrors: schemaErrors,
    manifest: null,
    manifestSha256: null,
    entrypointAssertion: null,
    classifications: [],
    status: 'BLOCKED',
    reason: null,
    detail: '',
    chainWritten: null,
    blockedArtifact: null,
  };
  if (schemaErrors.length > 0) {
    return {
      row: {
        ...base,
        reason: 'schema-invalid-sentinel',
        detail: `REFUSED before any evaluation: the sentinel FactBundle is schema-invalid (${schemaErrors.length} violation(s)). The module was never loaded.`,
      },
      host: null,
    };
  }

  // ── (a) the census, from the MODULE ──
  const wasm = fs.readFileSync(o.wasmPath);
  const census: WasmCensus = censusWasm(wasm);
  const manifest = entrypointManifest(census);
  const manifestPreimage = canonicalJson(manifest);
  const manifestSha256 = sha256(manifestPreimage);

  // ── (b) the only-exported-result-path assertion (§ Actuator slice 4) ──
  //
  // "not exactly one `<pkg>/result`" is checked against the CANONICAL spelling
  // derived from the package name, not only against what the caller expected: a
  // caller that passed a wrong `expectedEntrypoint` would otherwise be able to
  // certify a bundle whose single entrypoint is not `<pkg>/result` at all. Both
  // readings must agree, and both must be the canonical one.
  const declared = manifest.entrypoints;
  const canonical = `${o.packageName.replace(/\./g, '/')}/result`;
  const entrypointOk =
    declared.length === 1 && declared[0] === canonical && declared[0] === o.expectedEntrypoint;
  const entrypointAssertion = {
    ok: entrypointOk,
    detail: entrypointOk
      ? `exactly one entrypoint, and it is the canonical \`${canonical}\` (\`<pkg>/result\` derived from the package name, and the expected entrypoint agrees)`
      : `entrypoint set is ${JSON.stringify(declared)}; § Actuator slice 4 requires EXACTLY one \`${canonical}\` (the canonical \`<pkg>/result\` for package \`${o.packageName}\`; the caller expected \`${o.expectedEntrypoint}\`) — no ungated side entrypoints`,
  };

  // ── (c) evaluate EVERY declared entrypoint ──
  //
  // Every one, even when the assertion above already condemns the bundle: the
  // ruled text says certification EVALUATES EVERY EMITTED ENTRYPOINT, and a
  // certifier that stopped at the first gate would never have looked at the side
  // path it is complaining about.
  const sentinelPath = o.sentinelPathFor(o.sentinel);
  const host = hostCertify(o.wasmPath, sentinelPath, declared, {
    regoPath: o.regoPath,
    rule: `data.${o.packageName}.result`,
  });

  const classifications = host.wasmtime.loaded
    ? host.wasmtime.evaluations.map(classifyEvaluation)
    : declared.map((entrypoint) => ({
        entrypoint,
        status: 'BLOCKED' as const,
        reason: 'eval-error-or-trap' as BlockedReason,
        detail: `the module did not LOAD: ${firstLine(host.wasmtime.loadError ?? 'unknown load failure')}`,
      }));

  // ── (d) the bundle verdict ──
  const failed = classifications.find((c) => c.status === 'BLOCKED');
  let status: CertificationRow['status'] = 'PASS';
  let reason: CertificationRow['reason'] = null;
  let detail = `all ${classifications.length} entrypoint(s) returned a well-formed result`;
  if (!entrypointOk) {
    status = 'BLOCKED';
    reason = 'entrypoint-set-not-single-result';
    detail = entrypointAssertion.detail;
  } else if (failed) {
    status = 'BLOCKED';
    reason = failed.reason;
    detail = `\`${failed.entrypoint}\`: ${failed.detail}`;
  }

  return {
    row: {
      ...base,
      wasmSha256: sha256(wasm),
      evaluated: true,
      manifest,
      manifestSha256,
      entrypointAssertion,
      classifications,
      status,
      reason,
      detail,
    },
    host,
  };
}

// ─── Publication (clause e) ──────────────────────────────────────────────────

/**
 * Extend the computed chain with the entrypoint/import manifest hash and publish
 * it. The chain-input keys are spread FIRST and untouched, and the five new keys
 * are appended, so the published file's leading bytes are byte-identical to the
 * pre-slice chain and the extension is provably additive
 * (`src/certify-verify.mts` checks exactly that against `git show HEAD:`).
 */
function publishChain(
  chainInput: Record<string, unknown>,
  fileName: string,
  row: CertificationRow,
  host: HostCertifyResult,
): string {
  const chain = {
    ...chainInput,
    manifestSha256: row.manifestSha256,
    entrypointManifest: {
      note: 'The ENTRYPOINT/IMPORT manifest — the fourth member of the bound set (spec § Actuator slice 3). Distinct from the `manifest` key above, which is the OPA BUNDLE `.manifest` member. Read from the module itself by the same census code path as artifacts/opa-abi-census.json.',
      contract:
        'spec § Actuator slice 3 — manifestSha256 = sha256 of the canonical JSON of {entrypoints[], imports[], builtins{}}',
      manifest: row.manifest,
      canonicalPreimage: canonicalJson(row.manifest),
    },
    certified: true,
    certification: {
      contract:
        'spec § Actuator slice — "certification evaluates EVERY emitted entrypoint against a schema-valid sentinel FactBundle BEFORE artifact publication"',
      sentinel: SENTINEL,
      sentinelSha256: sha256(canonicalJson(SENTINEL)),
      onlyExportedResultPath: row.entrypointAssertion,
      evaluatedEntrypoints: row.classifications.map((c) => c.entrypoint),
      classifications: row.classifications,
      hosts: {
        wasmtime: {
          abiVersion: host.wasmtime.abiVersion ?? null,
          verdict: row.status,
        },
        regorus: {
          role: 'reference differential (LOWERING.md § Host contract) — not a certification gate',
          ok: host.regorus.ok ?? null,
          error: host.regorus.error ?? null,
        },
      },
      boundSet: [
        'source: recordSha256',
        'IR: regoSha256 (lowered .rego + globs + fact schema)',
        'guarded policy: regoComposition.components["policy.rego"]',
        'entrypoint/import manifest: manifestSha256',
        'final Wasm: wasmSha256',
      ],
    },
    publishedBy: 'spikes/spine-adopt/src/certify.mts (certification PASS)',
  };
  const at = path.join(CHAINS_DIR, fileName);
  fs.mkdirSync(CHAINS_DIR, { recursive: true });
  fs.writeFileSync(at, `${JSON.stringify(chain, null, 2)}\n`, 'utf-8');
  return path.relative(SPIKE_ROOT, at).split(path.sep).join('/');
}

function publishBlocked(row: CertificationRow, host: HostCertifyResult | null): string {
  const at = path.join(BLOCKED_DIR, `${row.package.replace(/^totem\.spike\./, '')}.json`);
  fs.mkdirSync(BLOCKED_DIR, { recursive: true });
  fs.writeFileSync(
    at,
    `${JSON.stringify(
      {
        generatedBy: 'spikes/spine-adopt/src/certify.mts',
        contract:
          'spec § Actuator slice 2 — "a blocked bundle produces `artifacts/blocked/<pkg>.json` (typed reason, no chain, wasm retained for forensics but never chained)"',
        id: row.id,
        kind: row.kind,
        package: row.package,
        blocked: true,
        certified: false,
        chain: null,
        chainNote: 'NO CHAIN. The chain artifact IS the certificate; a blocked bundle has none.',
        reason: row.reason,
        detail: row.detail,
        wasmSha256: row.wasmSha256,
        wasmRetainedFor: 'forensics only — present on disk, never chained',
        entrypointAssertion: row.entrypointAssertion,
        classifications: row.classifications,
        sentinel: row.sentinelValid ? SENTINEL : null,
        sentinelSchemaErrors: row.sentinelSchemaErrors,
        regorus: host ? host.regorus : null,
      },
      null,
      2,
    )}\n`,
    'utf-8',
  );
  return path.relative(SPIKE_ROOT, at).split(path.sep).join('/');
}

// ─── Fixture building ────────────────────────────────────────────────────────

function opa(
  args: string[],
  cwd: string,
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(OPA_BIN, args, { cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

interface Fixture {
  id: string;
  kind: CertificationRow['kind'];
  /** Directory under `rego/certify-fixtures/`, forward-slashed. */
  dir: string;
  packageName: string;
  /** Every entrypoint to BUILD. The first is the one the assertion expects. */
  entrypoints: string[];
  /** For the two negative fixtures: the corpus rule whose pattern this transcribes. */
  corpusRule?: string;
  expectedReason: CertificationRow['reason'];
  why: string;
}

const FIXTURES: Fixture[] = [
  {
    id: 'neg-lookahead',
    kind: 'negative-fixture',
    dir: 'neg-lookahead',
    packageName: 'totem.spike.certfix_neg_lookahead',
    entrypoints: ['totem/spike/certfix_neg_lookahead/result'],
    corpusRule: 'e64911592b774cc6',
    expectedReason: 'empty-result-set',
    why: 'negative lookahead — RE2 rejects `(?!` at compile, `opa build` accepts the policy (the measured fail-open)',
  },
  {
    id: 'backreference',
    kind: 'negative-fixture',
    dir: 'backreference',
    packageName: 'totem.spike.certfix_backreference',
    entrypoints: ['totem/spike/certfix_backreference/result'],
    corpusRule: '80192e6ac2a1dd3c',
    expectedReason: 'empty-result-set',
    why: "backreference — RE2 rejects `\\1` at compile; the corpus's only backreference pattern",
  },
  {
    id: 'two-entrypoints',
    kind: 'entrypoint-control',
    dir: 'two-entrypoints',
    packageName: 'totem.spike.certfix_two_entrypoints',
    entrypoints: [
      'totem/spike/certfix_two_entrypoints/result',
      'totem/spike/certfix_two_entrypoints/side_result',
    ],
    expectedReason: 'entrypoint-set-not-single-result',
    why: 'BOTH entrypoints classify PASS, so the block is attributable to the § Actuator slice 4 assertion alone — the proof it has teeth',
  },
  {
    id: 'ctl-eval-error',
    kind: 'classifier-control',
    dir: 'classifier-controls/eval-error',
    packageName: 'totem.spike.certctl_eval_error',
    entrypoints: ['totem/spike/certctl_eval_error/result'],
    expectedReason: 'eval-error-or-trap',
    why: '`regex.find_n` is host-delegated and `rust-opa-wasm` resolves it to `bail!("not implemented")` — the module loads and fails at CALL time',
  },
  {
    id: 'ctl-non-object',
    kind: 'classifier-control',
    dir: 'classifier-controls/non-object',
    packageName: 'totem.spike.certctl_non_object',
    entrypoints: ['totem/spike/certctl_non_object/result'],
    expectedReason: 'non-object',
    why: 'a DEFINED result that is a string',
  },
  {
    id: 'ctl-missing-keys',
    kind: 'classifier-control',
    dir: 'classifier-controls/missing-keys',
    packageName: 'totem.spike.certctl_missing_keys',
    entrypoints: ['totem/spike/certctl_missing_keys/result'],
    expectedReason: 'missing-keys',
    why: 'an object with `violations` and no `events` — absent = absent',
  },
  {
    id: 'ctl-extra-keys',
    kind: 'classifier-control',
    dir: 'classifier-controls/extra-keys',
    packageName: 'totem.spike.certctl_extra_keys',
    entrypoints: ['totem/spike/certctl_extra_keys/result'],
    expectedReason: 'extra-or-malformed-keys',
    why: 'both required keys plus a surplus one — PASS is EXACTLY the two',
  },
  {
    id: 'ctl-malformed-keys',
    kind: 'classifier-control',
    dir: 'classifier-controls/malformed-keys',
    packageName: 'totem.spike.certctl_malformed_keys',
    entrypoints: ['totem/spike/certctl_malformed_keys/result'],
    expectedReason: 'extra-or-malformed-keys',
    why: 'exactly the two keys, but `violations` is a string — the per-key type check',
  },
];

function buildFixture(f: Fixture): { wasmPath: string; regoPath: string; wasmSha256: string } {
  const srcDir = path.join(FIXTURES_DIR, ...f.dir.split('/'));
  const regoPath = path.join(srcDir, 'policy.rego');
  if (!fs.existsSync(regoPath))
    throw new Error(`fixture ${f.id} has no policy.rego at ${regoPath}`);
  const outDir = path.join(FIXTURE_BUILD_DIR, ...f.dir.split('/'));
  fs.mkdirSync(outDir, { recursive: true });
  const tarball = path.join(outDir, 'bundle.tar.gz');
  const args = ['build', '-t', 'wasm'];
  for (const e of f.entrypoints) args.push('-e', e);
  args.push('policy.rego', '-o', tarball);
  const r = opa(args, srcDir);
  if (r.status !== 0) {
    throw new Error(
      `pinned \`opa build\` REJECTED fixture ${f.id}. The ruled text says these are "fed DIRECTLY to \`opa build\` (which accepts them — the measured fail-open)"; a rejection here falsifies that premise and must be reported, not worked around.\n${r.stderr || r.stdout}`,
    );
  }
  const wasm = readBundleMember(tarball, 'policy.wasm');
  const wasmPath = path.join(outDir, 'policy.wasm');
  fs.writeFileSync(wasmPath, wasm);
  return { wasmPath, regoPath, wasmSha256: sha256(wasm) };
}

// ─── Main ────────────────────────────────────────────────────────────────────

interface LoweringArtifact {
  lowered: { specimen: string; ruleId: string; package: string; entrypoint: string; dir: string }[];
}

interface ChainInputs {
  chains: Record<string, unknown>[];
}

async function main(): Promise<void> {
  const checks = new Checks();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-certify-'));

  const readArtifact = <T,>(name: string, hint: string): T => {
    const at = path.join(ARTIFACTS_DIR, name);
    if (!fs.existsSync(at)) throw new Error(`${at} is missing — run \`${hint}\` first.`);
    return JSON.parse(fs.readFileSync(at, 'utf-8')) as T;
  };
  const lowering = readArtifact<LoweringArtifact>('lowering-rejects.json', 'npm run lower');
  const chainInputs = readArtifact<ChainInputs>('chain-inputs.json', 'npm run build-wasm');

  buildHost();

  // Sentinels are written once and reused, so every host reads the SAME bytes.
  const sentinelPaths = new Map<unknown, string>();
  let sentinelSeq = 0;
  const sentinelPathFor = (v: unknown): string => {
    let at = sentinelPaths.get(v);
    if (at === undefined) {
      at = path.join(tmp, `sentinel-${sentinelSeq++}.json`);
      fs.writeFileSync(at, `${JSON.stringify(v, null, 2)}\n`, 'utf-8');
      sentinelPaths.set(v, at);
    }
    return at;
  };

  // ── (f) the sentinel itself, and the validator's own falsifiers ──
  const sentinelErrors = validateFactBundle(SENTINEL);
  checks.eq('SENTINEL — the certification sentinel is schema-VALID', sentinelErrors, []);
  const malformedErrors = validateFactBundle(MALFORMED_SENTINEL);
  checks.check(
    'SENTINEL — the malformed control is schema-INVALID, on every field independently',
    malformedErrors.length >= 5,
    `${malformedErrors.length} violations: ${malformedErrors.join(' | ')}`,
  );
  const factFiles = fs
    .readdirSync(path.join(ARTIFACTS_DIR, 'facts'))
    .filter((f) => f.endsWith('.json'))
    .sort();
  const factRejects = factFiles
    .map((f) => ({
      file: f,
      errs: validateFactBundle(
        (
          JSON.parse(fs.readFileSync(path.join(ARTIFACTS_DIR, 'facts', f), 'utf-8')) as {
            factBundle: unknown;
          }
        ).factBundle,
      ),
    }))
    .filter((r) => r.errs.length > 0);
  checks.check(
    `SENTINEL — the validator is NOT vacuously strict: all ${factFiles.length} measured FactBundles validate`,
    factRejects.length === 0 && factFiles.length === 24,
    factRejects.length === 0
      ? `${factFiles.length}/${factFiles.length} accepted`
      : factRejects.map((r) => `${r.file}: ${r.errs.join('; ')}`).join(' | '),
  );

  // ── publication surfaces are rebuilt from scratch every run ──
  //
  // "chains are emitted ONLY here": a chain left behind by an earlier run — or by
  // the pre-slice `build-wasm.mts` — would be an unearned certificate. Both
  // directories are cleared, so what is on disk afterwards is exactly what THIS
  // certification produced.
  fs.rmSync(CHAINS_DIR, { recursive: true, force: true });
  fs.rmSync(BLOCKED_DIR, { recursive: true, force: true });
  fs.rmSync(FIXTURE_BUILD_DIR, { recursive: true, force: true });

  // ── the built bundles under rego/build/, enumerated from DISK ──
  const builtDirs = fs
    .readdirSync(REGO_BUILD_DIR, { withFileTypes: true })
    .filter(
      (d) => d.isDirectory() && fs.existsSync(path.join(REGO_BUILD_DIR, d.name, 'policy.wasm')),
    )
    .map((d) => d.name)
    .sort();
  checks.eq(
    'the bundles on disk under `rego/build/` are exactly the 7 the lowering declared',
    builtDirs,
    lowering.lowered.map((l) => l.package.replace(/^totem\.spike\./, '')).sort(),
  );
  checks.eq(
    'the build hand-off carries a computed chain for each of the 7',
    chainInputs.chains.length,
    7,
  );

  const rows: CertificationRow[] = [];
  const hostResults = new Map<string, HostCertifyResult>();

  // ── the 7 specimen bundles ──
  for (const suffix of builtDirs) {
    const lowRow = lowering.lowered.find((l) => l.package === `totem.spike.${suffix}`);
    if (!lowRow) throw new Error(`built bundle ${suffix} has no lowering row`);
    const chainInput = chainInputs.chains.find((c) => c.package === `totem.spike.${suffix}`);
    if (!chainInput)
      throw new Error(`built bundle ${suffix} has no computed chain in chain-inputs.json`);

    const dir = path.join(REGO_BUILD_DIR, suffix);
    const { row, host } = certifyBundle({
      id: `specimen:${lowRow.specimen}`,
      kind: 'specimen',
      packageName: lowRow.package,
      expectedEntrypoint: lowRow.entrypoint,
      wasmPath: path.join(dir, 'policy.wasm'),
      regoPath: path.join(dir, 'policy.rego'),
      sentinel: SENTINEL,
      sentinelPathFor,
    });

    // The certificate binds the wasm the certifier ACTUALLY evaluated: if the
    // hash the build computed and the hash on disk had diverged, the chain would
    // be attesting a different artifact from the one that passed.
    //
    // A HARD THROW, before `publishChain` can run — not a recorded failure. A
    // divergence here means the bytes under certification are not the bytes the
    // build measured, and a certificate for the wrong artifact must never reach
    // disk in the first place; reddening the run afterwards would leave a
    // published, wrong certificate behind for anything that read the directory.
    if (row.wasmSha256 !== chainInput.wasmSha256) {
      throw new Error(
        `${row.id} — PUBLICATION BLOCKED: the wasm the certifier evaluated (sha256 ${row.wasmSha256}) is NOT the wasm the build hashed into the chain (${String(chainInput.wasmSha256)}). ` +
          `The certificate would attest a different artifact from the one that passed certification. Re-run \`npm run build-wasm\` and certify again.`,
      );
    }
    checks.check(
      `${row.id} — the certified wasm is the wasm the build hashed (asserted BEFORE publication, as a hard throw)`,
      true,
      `${row.wasmSha256.slice(0, 16)}… on both sides`,
    );

    if (row.status === 'PASS') {
      row.chainWritten = publishChain(chainInput, `${suffix}.json`, row, host!);
    } else {
      row.blockedArtifact = publishBlocked(row, host);
    }
    rows.push(row);
    hostResults.set(row.id, host!);
    checks.check(
      `${row.id} — certification ${row.status}${row.reason ? ` (${row.reason})` : ''}`,
      row.status === 'PASS',
      row.detail,
    );

    // ── the sentinel's COVERAGE CEILING, made explicit ──
    //
    // The sentinel proves the guarded `result` rule is DEFINED. It cannot prove
    // anything about a builtin the module delegates to the HOST, because with no
    // lines and no ast matches no host builtin is ever called. That limit is only
    // safe while the certified modules delegate NOTHING — `builtins` empty means
    // every builtin the policy uses was compiled into the module by OPA, so the
    // sentinel evaluation exercises the same code every real evaluation would.
    // A certified specimen that started delegating would silently move behaviour
    // outside the sentinel's reach, so it is asserted rather than assumed.
    checks.eq(
      `${row.id} — the certified module delegates NO builtin to the host (\`builtins\` is \`{}\`), so the sentinel's coverage ceiling holds`,
      row.manifest?.builtins,
      {},
    );
  }

  // ── the hand-authored fixtures ──
  //
  // Provenance first: each negative fixture's target pattern is asserted
  // byte-exact against the corpus row it claims, so a fixture that had drifted
  // from its source could not quietly become a different test.
  const census = readArtifact<{ rules: { ruleHash: string; class: string; pattern: string }[] }>(
    'expressibility-census.json',
    'npm run census',
  );
  const fixtureBuilds = new Map<
    string,
    { wasmPath: string; regoPath: string; wasmSha256: string }
  >();
  for (const f of FIXTURES) {
    if (f.corpusRule) {
      const corpusRow = census.rules.find((r) => r.ruleHash === f.corpusRule);
      if (!corpusRow)
        throw new Error(
          `fixture ${f.id} cites corpus rule ${f.corpusRule}, which is not in the census`,
        );
      const source = fs.readFileSync(
        path.join(FIXTURES_DIR, ...f.dir.split('/'), 'policy.rego'),
        'utf-8',
      );
      const literal = JSON.stringify(corpusRow.pattern);
      const occurrences = source.split(literal).length - 1;
      checks.check(
        `FIXTURE ${f.id} — the target literal is the corpus pattern of ${f.corpusRule} (${corpusRow.class}), byte-exact and JSON-escaped`,
        occurrences === 2,
        occurrences === 2
          ? `found in both \`patterns_compile\` and \`target_hit\``
          : `expected 2 occurrences of the escaped corpus literal, found ${occurrences}`,
      );
    }
    const built = buildFixture(f);
    fixtureBuilds.set(f.id, built);
    checks.check(
      `FIXTURE ${f.id} — pinned \`opa build -t wasm\` ACCEPTS it (the measured fail-open the certifier exists to close)`,
      true,
      `${f.entrypoints.length} entrypoint(s), wasm ${built.wasmSha256.slice(0, 16)}…`,
    );
  }

  for (const f of FIXTURES) {
    const built = fixtureBuilds.get(f.id)!;
    const { row, host } = certifyBundle({
      id: `fixture:${f.id}`,
      kind: f.kind,
      packageName: f.packageName,
      expectedEntrypoint: f.entrypoints[0]!,
      wasmPath: built.wasmPath,
      regoPath: built.regoPath,
      sentinel: SENTINEL,
      sentinelPathFor,
    });
    // Guarded, not unconditional: a fixture that unexpectedly CERTIFIED must not
    // acquire a blocked artifact that contradicts its own verdict. The check
    // below is what fails in that case.
    if (row.status === 'BLOCKED') row.blockedArtifact = publishBlocked(row, host);
    rows.push(row);
    hostResults.set(row.id, host!);
    checks.eq(`FIXTURE ${f.id} — certification BLOCKS it`, row.status, 'BLOCKED');
    checks.eq(
      `FIXTURE ${f.id} — with the typed reason \`${f.expectedReason}\``,
      row.reason,
      f.expectedReason,
    );
    checks.eq(`FIXTURE ${f.id} — and NO chain is written`, row.chainWritten, null);
  }

  // ── the coverage-ceiling assertion's own teeth ──
  //
  // "Every certified specimen has empty `builtins`" would be a vacuous assertion
  // if no bundle in this run could have a non-empty one. The eval-error control
  // is exactly that counter-case: `regex.find_n` is host-delegated, so its module
  // DOES declare a host builtin — which is why it fails at CALL time rather than
  // at load. It is a control, never certified, and it keeps its builtins.
  const evalErrRow = rows.find((r) => r.id === 'fixture:ctl-eval-error')!;
  checks.check(
    'COVERAGE CEILING — the `builtins` assertion is not vacuous: the eval-error control DOES delegate a builtin to the host (and is blocked, never certified)',
    Object.keys(evalErrRow.manifest?.builtins ?? {}).length > 0 && evalErrRow.status === 'BLOCKED',
    `builtins=${JSON.stringify(evalErrRow.manifest?.builtins ?? {})}, status=${evalErrRow.status}`,
  );

  // ── the two-entrypoint control's teeth, stated as its own measurement ──
  const twoEp = rows.find((r) => r.id === 'fixture:two-entrypoints')!;
  checks.check(
    'ENTRYPOINT ASSERTION — the control declares TWO entrypoints, and BOTH classify PASS on their own',
    twoEp.classifications.length === 2 && twoEp.classifications.every((c) => c.status === 'PASS'),
    twoEp.classifications.map((c) => `${c.entrypoint.split('/').pop()}=${c.status}`).join(', '),
  );
  checks.eq(
    'ENTRYPOINT ASSERTION — so the block is attributable to the § Actuator slice 4 assertion ALONE',
    twoEp.reason,
    'entrypoint-set-not-single-result',
  );

  // ── (f) the malformed-sentinel control: refused BEFORE any eval ──
  const evalsBefore = hostEvalCount();
  const firstSpecimen = builtDirs[0]!;
  const firstLowered = lowering.lowered.find((l) => l.package === `totem.spike.${firstSpecimen}`)!;
  const { row: malformedRow } = certifyBundle({
    id: 'control:malformed-sentinel',
    kind: 'classifier-control',
    packageName: firstLowered.package,
    expectedEntrypoint: firstLowered.entrypoint,
    wasmPath: path.join(REGO_BUILD_DIR, firstSpecimen, 'policy.wasm'),
    regoPath: path.join(REGO_BUILD_DIR, firstSpecimen, 'policy.rego'),
    sentinel: MALFORMED_SENTINEL,
    sentinelPathFor,
  });
  const evalsAfter = hostEvalCount();
  checks.eq('MALFORMED SENTINEL — the certifier REFUSES it', malformedRow.status, 'BLOCKED');
  checks.eq(
    'MALFORMED SENTINEL — with the pre-eval typed reason `schema-invalid-sentinel`',
    malformedRow.reason,
    'schema-invalid-sentinel',
  );
  checks.check(
    'MALFORMED SENTINEL — refused BEFORE any eval: the host was not invoked once (a counter, not an assertion about intent)',
    evalsAfter === evalsBefore && malformedRow.evaluated === false,
    `host invocations ${evalsBefore} -> ${evalsAfter}; evaluated=${malformedRow.evaluated}`,
  );
  checks.check(
    'MALFORMED SENTINEL — and the SAME bundle certifies PASS on the valid sentinel (the refusal is about the sentinel, not the bundle)',
    rows.find((r) => r.package === firstLowered.package && r.kind === 'specimen')?.status ===
      'PASS',
    firstLowered.package,
  );
  // Deliberately NOT pushed into `rows`: it is a control on the SENTINEL, not a
  // certification of a bundle. It publishes nothing — no chain and no blocked
  // artifact — so folding it into the publication accounting would make the same
  // package look simultaneously chained and blocked.

  // ── classifier-branch UNIT controls ──
  //
  // Three branches of `classifyEvaluation` are unreachable from any wasm fixture
  // this spike can build: the OPA ABI always returns an array, always of length 0
  // or 1, and the wasmtime arm always emits a `result` field (null when the key is
  // absent). They are exercised DIRECTLY, on constructed host rows, so that no
  // branch of the classifier is untested — an untested branch is an unproven
  // classification, and a protocol violation is exactly the case where a
  // misclassification would matter most. No wasm is built for these: the input is
  // the `HostEvaluation` shape the hosts emit, and the function under test is the
  // same one the fixtures run through.
  const wellFormed = { violations: [], events: [] };
  const CLASSIFIER_UNIT_CONTROLS: {
    id: string;
    why: string;
    ev: HostEvaluation;
    expectReason: BlockedReason;
    expectDetailContains: string;
  }[] = [
    {
      id: 'unit:result-set-length-2',
      why: 'a result set of length 2 — an ABI protocol violation. `result` is well-formed, so ONLY the cardinality branch can block it.',
      ev: {
        entrypoint: 'unit/control/result',
        ok: true,
        error: null,
        resultSet: [{ result: wellFormed }, { result: wellFormed }],
        resultSetIsArray: true,
        resultSetLength: 2,
        result: wellFormed,
      },
      expectReason: 'eval-error-or-trap',
      expectDetailContains: 'the result set carried 2 entries; the protocol emits exactly one',
    },
    {
      id: 'unit:result-set-not-an-array',
      why: 'a result set that is not an array at all — the ABI-level protocol failure. `result` is well-formed, so ONLY the array branch can block it.',
      ev: {
        entrypoint: 'unit/control/result',
        ok: true,
        error: null,
        resultSet: { result: wellFormed },
        resultSetIsArray: false,
        resultSetLength: null,
        result: wellFormed,
      },
      expectReason: 'eval-error-or-trap',
      expectDetailContains: 'NON-ARRAY result set',
    },
    {
      id: 'unit:absent-result-key',
      why: 'a single-entry result set whose `result` key is absent — which the wasmtime arm encodes as JSON `null`. The branch the `undefined`-only test left dead.',
      ev: {
        entrypoint: 'unit/control/result',
        ok: true,
        error: null,
        resultSet: [{}],
        resultSetIsArray: true,
        resultSetLength: 1,
        result: null,
      },
      expectReason: 'eval-error-or-trap',
      expectDetailContains: 'serde `Option<Value>` → null',
    },
  ];
  const classifierUnitControls = CLASSIFIER_UNIT_CONTROLS.map((c) => {
    const got = classifyEvaluation(c.ev);
    checks.eq(
      `CLASSIFIER UNIT — ${c.id} is BLOCKED with the typed reason \`${c.expectReason}\``,
      [got.status, got.reason],
      ['BLOCKED', c.expectReason],
    );
    checks.check(
      `CLASSIFIER UNIT — ${c.id} names the defect: "${c.expectDetailContains}"`,
      got.detail.includes(c.expectDetailContains),
      got.detail,
    );
    return { id: c.id, why: c.why, input: c.ev, classification: got };
  });

  // ── the all-hosts failure rule (§ Actuator slice 5) ──
  const wazeroRows = wazeroConformance(
    FIXTURES.map((f) => ({
      id: f.id,
      wasm: path.relative(SPIKE_ROOT, fixtureBuilds.get(f.id)!.wasmPath).split(path.sep).join('/'),
      entrypoints: [] as string[],
    })),
    SENTINEL,
    tmp,
  );

  // Every field below that decides "did this host produce an error row" is read
  // from the HOST's own output — `failureRuleVerdict` for the two Rust arms, the
  // Go probe's `entrypointValue` error for wazero. The certifier's own
  // classifications are deliberately NOT consulted here: they are the certifier's
  // reading of a raw shape, and using them would turn "every host retains the
  // failure rule" into a claim about this file.
  interface HostVerdict {
    host: string;
    errored: boolean;
    cleanZero: boolean;
    kind: string;
    detail: string;
    /** The host's OWN error string, verbatim — empty/null means its rule never ran. */
    hostError: string | null;
    /** The function, in that host's source, that produced `hostError`. */
    hostErrorSource: string;
  }
  const allHosts: { fixture: string; required: boolean; hosts: HostVerdict[] }[] = [];
  for (const f of FIXTURES) {
    const row = rows.find((r) => r.id === `fixture:${f.id}`)!;
    const host = hostResults.get(`fixture:${f.id}`)!;
    const waz = wazeroRows.find((w) => w.id === f.id);
    if (!waz) throw new Error(`the wazero conformance run produced no row for fixture ${f.id}`);

    // wasmtime: main.rs's OWN `entrypoint_value` + `read_result` chain, run inside
    // `run_certify_arm` and reported as `failureRuleVerdict`. `errored` is that
    // verdict, not this file's classification of the raw shape.
    const wasmtimeFailures = host.wasmtime.evaluations.filter(
      (e) => e.failureRuleVerdict?.ok !== true,
    );
    const wasmtimeHostError =
      host.wasmtime.loaded === false
        ? (host.wasmtime.loadError ?? null)
        : (wasmtimeFailures.find((e) => (e.failureRuleVerdict?.error ?? '').trim() !== '')
            ?.failureRuleVerdict?.error ?? null);
    const wasmtimeVerdict: HostVerdict = {
      host: 'wasmtime (rust-opa-wasm)',
      errored: host.wasmtime.loaded === false || wasmtimeFailures.length > 0,
      cleanZero:
        host.wasmtime.loaded === true &&
        host.wasmtime.evaluations.length > 0 &&
        host.wasmtime.evaluations.every(
          (e) => e.failureRuleVerdict?.ok === true && isCleanZero(e.result),
        ),
      // The typed CLASS is the certifier's mapping (one place, all three hosts);
      // whether there was an error at all is the host's.
      kind: row.classifications.find((c) => c.status === 'BLOCKED')?.reason ?? 'well-formed',
      detail:
        host.wasmtime.loaded === false
          ? firstLine(host.wasmtime.loadError ?? 'the module did not load')
          : host.wasmtime.evaluations
              .map(
                (e) =>
                  `${e.entrypoint.split('/').pop()}: ${
                    e.failureRuleVerdict?.ok === true
                      ? 'ok'
                      : firstLine(e.failureRuleVerdict?.error ?? 'NO VERDICT RECORDED')
                  }`,
              )
              .join('; '),
      hostError: wasmtimeHostError,
      hostErrorSource:
        'host/src/main.rs `entrypoint_value` + `read_result`, executed inside `run_certify_arm` and reported as `failureRuleVerdict`',
    };

    // regorus: the same treatment — `run_regorus_arm`'s undefined/non-object
    // rejection followed by `read_result`, executed in the certify arm.
    const rg = host.regorus;
    const rgVerdict = rg.failureRuleVerdict;
    const rgClean = isCleanZero(rg.value);
    const regorusVerdict: HostVerdict = {
      host: 'regorus',
      errored: rg.ran === true && rgVerdict?.ok === false,
      cleanZero: rg.ran === true && rgVerdict?.ok === true && rgClean,
      kind: rg.error ? 'eval-error' : rg.undefined ? 'undefined-rule' : 'value',
      detail: firstLine(rgVerdict?.error ?? rg.error ?? JSON.stringify(rg.value ?? null)),
      hostError: rgVerdict?.error ?? rg.error ?? null,
      hostErrorSource:
        "host/src/main.rs `run_certify_arm` regorus block — `run_regorus_arm`'s undefined/null/non-object rejection + `read_result`, reported as `failureRuleVerdict`",
    };

    // wazero: `e.error` is what the probe's OWN `entrypointValue` + `readResult`
    // chain returned (wazero-probe/main.go), recorded by conformance.go. The
    // empty-result-set and result-shape error rows both originate in Go; nothing
    // here re-derives either from a length.
    const wazFailures = waz.evaluations.filter((e) => !e.ok || e.error !== null);
    const wazeroVerdict: HostVerdict = {
      host: 'wazero',
      errored: waz.loaded === false || wazFailures.length > 0,
      cleanZero:
        waz.loaded === true &&
        waz.evaluations.length > 0 &&
        waz.evaluations.every((e) => e.ok && e.error === null && isCleanZero(e.result)),
      kind:
        waz.loaded === false
          ? 'load-error'
          : wazFailures.length === 0
            ? 'value'
            : /EMPTY RESULT SET/.test(wazFailures[0]?.error ?? '')
              ? 'empty-result-set'
              : 'eval-error',
      detail:
        waz.loaded === false
          ? firstLine(waz.loadError ?? '')
          : waz.evaluations
              .map(
                (e) =>
                  `${e.entrypoint.split('/').pop()}: ${e.error ? firstLine(e.error) : `len=${e.resultSetLength}`}`,
              )
              .join('; '),
      hostError:
        waz.loaded === false
          ? (waz.loadError ?? null)
          : (wazFailures.find((e) => (e.error ?? '').trim() !== '')?.error ?? null),
      hostErrorSource:
        'wazero-probe/main.go `entrypointValue` + `readResult`, executed by conformance.go `runConformanceCase`',
    };

    allHosts.push({
      fixture: f.id,
      required: f.kind === 'negative-fixture',
      hosts: [wasmtimeVerdict, regorusVerdict, wazeroVerdict],
    });
  }

  for (const a of allHosts.filter((x) => x.required)) {
    for (const h of a.hosts) {
      checks.check(
        `ALL-HOSTS FAILURE RULE — ${a.fixture} on ${h.host}: an ERROR row`,
        h.errored,
        `${h.kind} — ${h.detail}`,
      );
      // A boolean is not evidence that a host has a failure rule — the certifier
      // could compute one. The error STRING is: it can only exist because that
      // host's own code raised it, and it names the function that did.
      checks.check(
        `ALL-HOSTS FAILURE RULE — ${a.fixture} on ${h.host}: the error row is HOST-ORIGINATED — a non-empty error string from ${h.hostErrorSource}`,
        h.errored && typeof h.hostError === 'string' && h.hostError.trim().length > 0,
        h.hostError === null || h.hostError.trim() === ''
          ? 'NO host-produced error string — the host reported no verdict of its own, so this row is the certifier talking to itself'
          : firstLine(h.hostError),
      );
      checks.check(
        `ALL-HOSTS FAILURE RULE — ${a.fixture} on ${h.host}: NEVER a clean zero`,
        !h.cleanZero,
        h.cleanZero
          ? 'RETURNED {violations: [], events: []} — a fail-open'
          : 'no clean-zero verdict',
      );
    }
  }

  // ── the clean-zero POSITIVE control ──
  //
  // Every assertion above is `!cleanZero`. A `cleanZero` that could never be
  // TRUE satisfies all of them and proves nothing — the negative rows would pass
  // just as happily against a predicate hard-wired to `false`. `two-entrypoints`
  // is the control: a VALID policy whose `result` genuinely is the zero verdict
  // (both entrypoints classify PASS with 0 violations and 0 events). Each host
  // must recognise it AS a clean zero, or the negative rows above are vacuous.
  const cleanZeroControl = allHosts.find((x) => x.fixture === 'two-entrypoints');
  checks.check(
    'CLEAN-ZERO CONTROL — the positive fixture reached the all-hosts table',
    cleanZeroControl !== undefined && cleanZeroControl.hosts.length === 3,
    cleanZeroControl
      ? `${cleanZeroControl.hosts.length} host(s)`
      : 'two-entrypoints is MISSING from the all-hosts table',
  );
  for (const h of cleanZeroControl?.hosts ?? []) {
    checks.check(
      `CLEAN-ZERO CONTROL — two-entrypoints on ${h.host}: a valid zero-violation result IS recognised as a clean zero (so the \`NEVER a clean zero\` rows above are not vacuous)`,
      h.cleanZero === true && h.errored === false,
      `cleanZero=${h.cleanZero} errored=${h.errored} — ${h.detail}`,
    );
  }

  // ── the five typed reasons, each OBSERVED ──
  const observed = new Set(
    rows
      .map((r) => r.reason)
      .filter((r): r is BlockedReason => (BLOCKED_REASONS as readonly string[]).includes(r ?? '')),
  );
  checks.eq(
    'CLASSIFIER — all FIVE typed blocked reasons are REACHABLE and observed in this run',
    [...observed].sort(),
    [...BLOCKED_REASONS].sort(),
  );

  // ── publication semantics, measured on the filesystem ──
  const chainFiles = fs.existsSync(CHAINS_DIR) ? fs.readdirSync(CHAINS_DIR).sort() : [];
  const blockedFiles = fs.existsSync(BLOCKED_DIR) ? fs.readdirSync(BLOCKED_DIR).sort() : [];
  checks.eq(
    'PUBLICATION — `artifacts/chains/` holds EXACTLY the certified bundles, one file each',
    chainFiles,
    rows
      .filter((r) => r.status === 'PASS')
      .map((r) => `${r.package.replace(/^totem\.spike\./, '')}.json`)
      .sort(),
  );
  checks.eq(
    'PUBLICATION — every blocked bundle has an `artifacts/blocked/<pkg>.json` and no chain',
    blockedFiles.length,
    new Set(
      rows
        .filter((r) => r.status === 'BLOCKED')
        .map((r) => r.package.replace(/^totem\.spike\./, '')),
    ).size,
  );
  const blockedPkgs = new Set(
    rows
      .filter((r) => r.status === 'BLOCKED')
      .map((r) => `${r.package.replace(/^totem\.spike\./, '')}.json`),
  );
  checks.eq(
    'PUBLICATION — no bundle is both chained and blocked',
    chainFiles.filter((f) => blockedPkgs.has(f)),
    [],
  );

  // ── the report ──
  writeArtifact('certification-report.json', {
    generatedBy: 'spikes/spine-adopt/src/certify.mts',
    contract:
      'spec `.totem/specs/spine-spike.md` § "Actuator slice (slice 1 — BINDING condition 1 of the 2026-08-28 conditional adoption word)"',
    ruledText:
      'certification evaluates EVERY emitted entrypoint against a schema-valid sentinel FactBundle BEFORE artifact publication; empty / undefined / error / non-object / missing result keys BLOCK the artifact and its certificate; the guard lives in the only exported result path; every host retains the failure rule; negative conformance fixtures exercise unsupported patterns on all hosts; the certificate chain binds source · IR · guarded policy · entrypoint/import manifest · final Wasm hash.',
    sentinel: {
      bundle: SENTINEL,
      sha256: sha256(canonicalJson(SENTINEL)),
      rationale:
        'Schema-valid and neutral (spec § Actuator slice 1): with no lines and no ast matches, no policy can produce a violation of its own, so the only thing that varies across bundles is whether the guarded `result` rule is DEFINED.',
      schemaContract:
        'rego/LOWERING.md § Input contract — input = { file, fileText: string|null, lines: [string], astMatches: [{lineNumber, lineText, startLineText, startPrecedingLineText}] }',
      validatorAcceptsAllMeasuredBundles: factFiles.length,
      malformedControl: {
        bundle: MALFORMED_SENTINEL,
        schemaErrors: malformedErrors,
        refusedBeforeAnyEval: malformedRow.evaluated === false,
        hostInvocationsDuringRefusal: evalsAfter - evalsBefore,
        appliedToBundle: malformedRow.package,
        note: 'Fed to a bundle that certifies PASS on the valid sentinel, so the refusal is attributable to the SENTINEL and not to the bundle. It publishes nothing — neither a chain nor a blocked artifact.',
        row: malformedRow,
      },
    },
    blockedClasses: {
      contract:
        'spec § Actuator slice 1 — "The discriminator is well-formed-object vs {empty result set, eval error/trap, non-object, missing keys} — five blocked classes, each a typed reason."',
      resultClasses: BLOCKED_REASONS,
      preEvalGates: [
        {
          reason: 'entrypoint-set-not-single-result',
          clause: '§ Actuator slice 4 — the only-exported-result-path assertion',
          note: 'A gate on the BUNDLE, not a class of result — typed separately rather than squeezed into the five.',
        },
        {
          reason: 'schema-invalid-sentinel',
          clause: '§ Actuator slice 5 — "must be refused by the certifier itself before any eval"',
          note: 'Refused before the module is opened; the host is never invoked.',
        },
      ],
      observedThisRun: [...observed].sort(),
    },
    publication: {
      contract:
        'spec § Actuator slice 2 — "the chain artifact IS the certificate. `certify` gates chain emission — `artifacts/chains/*.json` is written ONLY on certification PASS; a blocked bundle produces `artifacts/blocked/<pkg>.json` (typed reason, no chain, wasm retained for forensics but never chained)."',
      chainWriter:
        'spikes/spine-adopt/src/certify.mts — the ONLY writer; src/build-wasm.mts now hands its computed chains over as artifacts/chain-inputs.json',
      chainExtension:
        '{recordSha256, regoSha256 (the GUARDED policy), manifestSha256 (sha256 of the canonical JSON of {entrypoints[], imports[], builtins{}}), wasmSha256, certified: true} — ADDITIVE: the pre-slice keys are carried through untouched and the new keys are appended.',
      chainsWritten: chainFiles,
      blockedWritten: blockedFiles,
    },
    certifications: rows,
    fixtures: FIXTURES.map((f) => ({
      id: f.id,
      kind: f.kind,
      source: `rego/certify-fixtures/${f.dir}/policy.rego`,
      package: f.packageName,
      corpusRule: f.corpusRule ?? null,
      entrypointsBuilt: f.entrypoints,
      expectedReason: f.expectedReason,
      why: f.why,
      wasmSha256: fixtureBuilds.get(f.id)!.wasmSha256,
      opaBuildAccepted: true,
    })),
    allHostsFailureRule: {
      contract:
        'spec § Actuator slice 5 — "must be (a) BLOCKED by certification, and (b) produce error rows — never clean zeros — on all three hosts (wasmtime host, regorus, wazero)."',
      requiredFixtures: FIXTURES.filter((f) => f.kind === 'negative-fixture').map((f) => f.id),
      evidenceRule:
        "Each host RUNS its own failure rule and reports the verdict; this file reads that verdict. `errored` is never derived from the certifier's classifications, and every required row additionally carries `hostError` — the host's own error string, verbatim — plus `hostErrorSource`, the function that produced it.",
      hostFailureRules: {
        'wasmtime (rust-opa-wasm)':
          'host/src/main.rs `entrypoint_value` then `read_result`, executed inside `run_certify_arm` (the SAME two functions `run_opa_arm` uses) and reported per evaluation as `failureRuleVerdict`. An empty result SET, a non-array set, a set of length ≠ 1, a non-object result, a missing violations/events key, or a non-array value for either key is an ERROR, never a zero-violation verdict.',
        regorus:
          "host/src/main.rs `run_certify_arm`'s regorus block, reported as `failureRuleVerdict`: `set_strict_builtin_errors(true)`; an Err from `eval_rule`, a null/`<undefined>`/non-object value (the `run_regorus_arm` rejection, main.rs:440-443), then `read_result` — the same chain the normal regorus arm applies.",
        wazero:
          'wazero-probe/main.go `entrypointValue` + `readResult`, called by conformance.go `runConformanceCase` — an empty result set is an ERROR raised in Go, a result whose SHAPE is not `{violations[], events[]}` is rejected by the same `readResult` the differential run uses, and the `opa_builtin*` stubs panic rather than fabricate a return value (the conformance mode recovers the panic into an error ROW so the failure is data, not a dead process).',
      },
      rows: allHosts,
    },
    classifierUnitControls: {
      contract:
        'NOTE 6/7 fold — every branch of `classifyEvaluation` must be exercised. Three are unreachable from any buildable wasm fixture (non-array result set, a set of length ≠ {0,1}, an absent `result` key) and are driven directly on constructed `HostEvaluation` rows.',
      controls: classifierUnitControls,
    },
    wazeroConformance: wazeroRows,
    checks: checks.rows,
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(
    `\n${chainFiles.length} certificate chain(s) -> artifacts/chains/   ${blockedFiles.length} blocked -> artifacts/blocked/`,
  );
  checks.finish('certify');
}

await main();
