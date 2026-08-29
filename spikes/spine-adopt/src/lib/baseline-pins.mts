// ─── The pinned digests — the ONLY home for a sha256 constant ────────────────
//
// Spec `.totem/specs/seed20-apparatus-slice2.md` constraint 4: "sha256 constants
// live in a new `src/lib/baseline-pins.mts`, the ONLY home for pinned digests".
// Every value below was computed by the build leg from the blob it names —
// `git show <pin>:<path> | sha256sum` — and re-verified against the working tree
// at authoring time; nothing here was transcribed from prose.
//
// Two kinds of pin live here:
//
//   K6 (§ S4)  the BYTE-IDENTITY baseline at `6ca24d42`: the two shipped spine
//              sources the charter names, the lowering contract, the `[opa]`
//              toolchain row, and the emitter's own source region. A delta on any
//              of them is a FAILED check — the run refuses, and whether the delta
//              is benign is the owner's to state in the record, never the
//              apparatus's to wave through.
//   constraint 4  the frozen CONTROL inputs (K8 fixtures, K3 captures) that are
//              byte-pinned in the tree and re-verified at run time.
//
// The K5 control record is deliberately NOT here: it is checked by sha EQUALITY
// against its sibling `records/d-requires-file.rule.yaml`, because a constant
// would only prove that the constant and the copy agree.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { REPO_ROOT, sha256, SPIKE_ROOT } from './spike-env.mts';

/** The commit the K6 byte-identity baseline is taken at. */
export const BASELINE_PIN = '6ca24d42';

/** Which slice of a file a row's digest covers. */
export type ByteIdentityRegion = 'file' | 'section:[opa]' | 'symbol:emitPolicy';

export interface ByteIdentityPin {
  /** Repo-relative, forward-slashed. */
  path: string;
  region: ByteIdentityRegion;
  expected: string;
  /** Why this file is on the list — the claim the digest is evidence for. */
  why: string;
}

/**
 * The `[opa]` SECTION of `toolchain.lock`, from the `[opa]` line to the next blank
 * line, with a trailing newline.
 *
 * The whole file legitimately differs between `6ca24d42` and HEAD — the Go/wazero
 * rows were added by the apparatus slice — so a whole-file pin would fail for a
 * reason that has nothing to do with the OPA pin the K6 claim is about.
 */
export function extractOpaSection(text: string): string | null {
  const lines = text.split('\n');
  const start = lines.indexOf('[opa]');
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && lines[end]!.trim() !== '') end += 1;
  return `${lines.slice(start, end).join('\n')}\n`;
}

/**
 * The `emitPolicy` SYMBOL's source text, from its `function emitPolicy(` line to
 * the line before the next top-level `function` / `export` / comment-block start.
 *
 * By SYMBOL, never by line number: the emitter's line numbers move whenever
 * anything above it in `src/lower.mts` changes, and the claim constraint 3 makes
 * is about the emitted BYTES, whose only source is this function.
 */
export function extractEmitPolicySymbol(text: string): string | null {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('function emitPolicy('));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^(?:export\b|function\b|\/\/ ───)/.test(lines[end]!)) end += 1;
  return `${lines.slice(start, end).join('\n')}\n`;
}

/**
 * The K6 rows (§ S4).
 *
 * `rego/LOWERING.md` is pinned WHOLE, and its `## Input contract` heading is
 * additionally re-located at run time by `factSchemaLine()` (`src/lower.mts`),
 * which throws when the heading or its backticked span is absent — so the schema
 * line the chain hashes cannot drift from the contract even within an unchanged
 * digest.
 */
export const BYTE_IDENTITY_PINS: readonly ByteIdentityPin[] = [
  {
    path: 'packages/core/src/spine/rule-record.ts',
    region: 'file',
    expected: '34af45324b0d8298855ca4de6b20ee16089e2437d866267082c802ecd8faf1ff',
    why: 'the shipped § Design 4/5 parser — the record schema K8 exercises and the trial reads records through.',
  },
  {
    path: 'packages/core/src/spine/record-lower.ts',
    region: 'file',
    expected: '63a8415e7095ba06f65cee6185c84b9008e42399f5c507b9c8b86c71729a937e',
    why: 'the shipped record→rule lowering — the byte-identity ground the charter names.',
  },
  {
    path: 'spikes/spine-adopt/rego/LOWERING.md',
    region: 'file',
    expected: 'd031189ed6a412e088f747b5e2a2f1ed8b6d8ec3e189db6efcffa775b31fd5f7',
    why: 'the binding lowering contract; its § Input contract line is one of the three inputs to every chain IR hash.',
  },
  {
    path: 'spikes/spine-adopt/toolchain.lock',
    region: 'section:[opa]',
    expected: '6de88005604d33727c38021f6adb8ef37b9c5219dd7689d9f727b2a799257f92',
    why: 'the OPA pin the whole differential is measured on. SECTION, not file: the Go/wazero rows were added after the baseline pin.',
  },
  {
    path: 'spikes/spine-adopt/src/lower.mts',
    region: 'symbol:emitPolicy',
    expected: 'c41bb536bb4d6a015c687dbd6750e50277a337ee18336a6c5896efc37ce0bf1c',
    why: 'constraint 3 — the EMITTED POLICY stays byte-stable, and this function is the only thing that emits it.',
  },
];

export interface ByteIdentityRow {
  path: string;
  region: ByteIdentityRegion;
  expected: string;
  actual: string | null;
  eq: boolean;
}

/** Read one row's region out of the working tree and digest it. */
function actualDigest(pin: ByteIdentityPin): string | null {
  const abs = path.join(REPO_ROOT, ...pin.path.split('/'));
  if (!fs.existsSync(abs)) return null;
  const text = fs.readFileSync(abs, 'utf-8');
  if (pin.region === 'file') return sha256(fs.readFileSync(abs));
  const region =
    pin.region === 'section:[opa]' ? extractOpaSection(text) : extractEmitPolicySymbol(text);
  return region === null ? null : sha256(region);
}

/**
 * The K6 measurement: every pinned region, re-read from the working tree and
 * compared against `BASELINE_PIN`. A row whose region cannot be located at all
 * carries `actual: null` and `eq: false` — an unfindable symbol is a delta, not a
 * skip.
 */
export function byteIdentityRows(): ByteIdentityRow[] {
  return BYTE_IDENTITY_PINS.map((p) => {
    const actual = actualDigest(p);
    return {
      path: p.path,
      region: p.region,
      expected: p.expected,
      actual,
      eq: actual === p.expected,
    };
  });
}

// ─── Constraint 4 — the frozen control inputs ────────────────────────────────

/**
 * The two K8 fixtures, byte-identical to strategy's
 * `operations/310-seed20-target/fixtures/k8/*` (the greenfield K1/K1b originals).
 */
export const K8_FIXTURE_SHA256: Readonly<Record<string, string>> = {
  'seed/controls/k8/k8-unknown-key.rule.yaml':
    'f6610f9a355d8ce80cbe24eb803421d376f9d350670806ef59cfb2d0492431d4',
  'seed/controls/k8/k8-missing-mandatory.rule.yaml':
    'a0c67c7d4f4762e3d5817115be67ba846b7d7a75eb80d2464459980a48467d84',
};

/**
 * The K3 target captures — `git show 044e114b:…artifacts/lowered/r87aff037d7de47a7/policy.rego`
 * and `…artifacts/chains/r87aff037d7de47a7.json`. Constraint 3 names both digests
 * as the ones that must still reproduce.
 */
export const K3_CAPTURE_SHA256: Readonly<Record<string, string>> = {
  'seed/controls/k3/k3-target.policy.rego':
    '528c8d80ce148a404c2a6ff97fcb6df5b889eeeab83228618b5c455932ee48db',
  'seed/controls/k3/k3-target.chain.json':
    '2a4d56caf0b4d18157ecf823374f3bf784b3c857f92faf148aa159f431fe3881',
};

/** Every spike-relative path this module pins, with its expected digest. */
export const SPIKE_FILE_PINS: Readonly<Record<string, string>> = {
  ...K8_FIXTURE_SHA256,
  ...K3_CAPTURE_SHA256,
};

/** The measured digest of a spike-relative pinned file, or `null` when it is absent. */
export function spikeFileDigest(rel: string): string | null {
  const abs = path.join(SPIKE_ROOT, ...rel.split('/'));
  return fs.existsSync(abs) ? sha256(fs.readFileSync(abs)) : null;
}

/**
 * The § 5 COMMENT-STRIPPED form of a published `policy.rego`: the code lines only —
 * every line whose first non-blank character is `#` removed, and every blank line
 * removed. Published as `manifest.k3Capture.policyRegoCodeSha256`, so the digest
 * the charter's § 5 asks for is the apparatus's own claim rather than a number
 * computed once by hand beside it.
 */
export function policyRegoCodeText(policyRego: string): string {
  const code = policyRego
    .split('\n')
    .filter((l) => l.trim().length > 0 && !l.trimStart().startsWith('#'));
  return `${code.join('\n')}\n`;
}
