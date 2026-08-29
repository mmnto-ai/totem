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
export type ByteIdentityRegion = 'file' | 'section:[opa]' | `symbol:${string}`;

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
 * A line that OPENS a top-level declaration, and a `// ───` section rule. Together
 * they are the terminator of a symbol region: the region runs from the symbol's own
 * declaration line to the line BEFORE the next one of these.
 */
const TOP_LEVEL_DECL_START =
  /^(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\b/;
const SECTION_RULE = /^\/\/ ───/;

/**
 * (§ S4, fold 1 F10 — `.totem/specs/seed20-apparatus-slice2-fold1.md`) ONE symbol's
 * source text out of `src/lower.mts`, by NAME.
 *
 * The region starts at the line that DECLARES the symbol — `function <name>(`,
 * `export function <name>(`, `const <name> =`, `export const <name> =`, or
 * `export const <name>:` — and ends at the line before the next top-level
 * declaration or `// ───` section rule.
 *
 * By SYMBOL, never by line number: every one of these moves whenever anything
 * above it in `src/lower.mts` changes, and the claim constraint 3 makes is about
 * the emitted BYTES, whose only sources are these seven symbols (charter § 5 K3
 * names them).
 *
 * The region is a CONTIGUOUS text span, so a symbol whose next neighbour carries a
 * doc comment includes that comment (`SAME_LINE_MARKERS` does). That is deliberate
 * and stable at both pins: a wider region can only make the K6 claim stricter, and
 * a narrower one would need a parser to draw the boundary.
 */
export function extractSymbolRegion(text: string, name: string): string | null {
  const openers = [
    `function ${name}(`,
    `export function ${name}(`,
    `const ${name} =`,
    `export const ${name} =`,
    `export const ${name}:`,
  ];
  const lines = text.split('\n');
  const start = lines.findIndex((l) => openers.some((o) => l.startsWith(o)));
  if (start < 0) return null;
  let end = start + 1;
  while (
    end < lines.length &&
    !TOP_LEVEL_DECL_START.test(lines[end]!) &&
    !SECTION_RULE.test(lines[end]!)
  ) {
    end += 1;
  }
  return `${lines.slice(start, end).join('\n')}\n`;
}

/**
 * (fold 1 F10) The SEVEN emitter symbols charter § 5 K3 names as the producers of
 * non-comment policy bytes, in the charter's own order.
 */
export const EMITTER_SYMBOLS: readonly string[] = [
  'emitPolicy',
  'SAME_LINE_MARKERS',
  'PRECEDING_LINE_MARKERS',
  'globToRegexSource',
  'packageSuffix',
  'q',
  'regoStringArray',
];

/**
 * (fold 2 H5, `.totem/specs/seed20-apparatus-slice2-fold2.md`) One DISCLOSED delta,
 * keyed on the DIGEST PAIR rather than on the symbol name.
 *
 * `expected` is the `BASELINE_PIN` digest (the same value the row's pin carries) and
 * `actual` is the digest at THIS pin. Both were computed by the build leg with
 * `extractSymbolRegion` below over `git show 6ca24d42:spikes/spine-adopt/src/lower.mts`
 * and over the working tree — the same extractor that draws the measured region.
 */
export interface ExpectedDelta {
  expected: string;
  actual: string;
  reason: string;
}

/**
 * (fold 1 F10, re-keyed by fold 2 H5) The DISCLOSED deltas: a symbol whose region
 * digest moved between `BASELINE_PIN` and this pin, with the owner's benignity
 * statement.
 *
 * A row on this map does not FAIL the run — it is DISCLOSED, printed in the header
 * and carried in `manifest.byteIdentity`. A row NOT on it that differs still
 * refuses: the apparatus never decides that a delta is benign, it only carries the
 * statement the owner already made in the design record.
 *
 * (fold 2 H5) The disclosure holds for ONE pair of digests, never for the symbol as
 * such. A statement about the `specimenId` -> `discriminator` rename says nothing
 * about the NEXT edit to `packageSuffix`, and a name-keyed map would have waved that
 * one through too — so the measured `actual` must equal the pinned `actual` (and the
 * row's `expected` must still be the pin this statement was written against) or the
 * delta is undisclosed and refuses.
 */
export const EXPECTED_DELTAS: Readonly<Record<string, ExpectedDelta>> = {
  packageSuffix: {
    expected: '25fd4366d30f08d2506a14efac97e4b02374fa4dbbacdaf71ada231b9f99f637',
    actual: '442d640cd3be4d6bc0cf385fdfc4fe31bf9e36b8146f7fc70777f7e5a822c5b5',
    reason:
      "the parameter rename `specimenId` -> `discriminator` (mmnto-ai/totem#2694 G1: the suffix is the row's `packageDiscriminator`, which is the specimen id on the specimens set and the declared language on the seed set). The BODY is byte-identical modulo that identifier and the emitted bytes are unchanged — proven by the seven committed chains reproducing under INV 2.",
  },
};

/**
 * The K6 rows (§ S4).
 *
 * `rego/LOWERING.md` is pinned WHOLE, and its `## Input contract` heading is
 * additionally re-located at run time by `factSchemaLine()` (`src/lower.mts`),
 * which throws when the heading or its backticked span is absent — so the schema
 * line the chain hashes cannot drift from the contract even within an unchanged
 * digest.
 *
 * (fold 1 F10) The four FILE/SECTION rows come first, then one `symbol:` row per
 * emitter symbol — the seven the charter names, not `emitPolicy` alone: five of the
 * six feeders sit OUTSIDE `emitPolicy`'s own region, so a byte-identity claim about
 * the emitter alone left them unmeasured.
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
  // (fold 1 F10) The seven emitter symbols, each digested over the region
  // `extractSymbolRegion` draws. Every `expected` below was computed by the build
  // leg from `git show 6ca24d42:spikes/spine-adopt/src/lower.mts` with THAT
  // function — the same extractor that reads the working tree — so the two sides of
  // the comparison are drawn by one rule.
  {
    path: 'spikes/spine-adopt/src/lower.mts',
    region: 'symbol:emitPolicy',
    expected: 'c41bb536bb4d6a015c687dbd6750e50277a337ee18336a6c5896efc37ce0bf1c',
    why: 'constraint 3 — the EMITTED POLICY stays byte-stable, and this function is the body that emits it.',
  },
  {
    path: 'spikes/spine-adopt/src/lower.mts',
    region: 'symbol:SAME_LINE_MARKERS',
    expected: '2824956ce95ad4b8f8ba1113ee0ec9bf3f5f99899af0c8a72ba138643c350516',
    why: '§ Lowering 7 — the same-line suppression marker set, emitted verbatim into every policy.',
  },
  {
    path: 'spikes/spine-adopt/src/lower.mts',
    region: 'symbol:PRECEDING_LINE_MARKERS',
    expected: '0365b26a686b71eccd4212206f790fcdbbb39ab8cc8bb5efd71cd1a407bce1ec',
    why: '§ Lowering 7 — the preceding-line marker set, and the § Lowering 7 deferral`s own site.',
  },
  {
    path: 'spikes/spine-adopt/src/lower.mts',
    region: 'symbol:globToRegexSource',
    expected: '059aa53ee4b42b993bddc0cfb3e40740c2eb8b42abd7fb58161cebbb33f008e4',
    why: '§ Lowering 5 — every glob regex in the emitted policy and in `globs.json` comes from here.',
  },
  {
    path: 'spikes/spine-adopt/src/lower.mts',
    region: 'symbol:packageSuffix',
    expected: '25fd4366d30f08d2506a14efac97e4b02374fa4dbbacdaf71ada231b9f99f637',
    why: '§ Lowering 1 — the package name and the entrypoint, both emitted into the policy header.',
  },
  {
    path: 'spikes/spine-adopt/src/lower.mts',
    region: 'symbol:q',
    expected: '1bf1fc350c0dfe130faffeae0994567e5fe47eda3fb5e03a94b4d2fa63458b4c',
    why: 'every string literal the emitter writes is escaped by this function.',
  },
  {
    path: 'spikes/spine-adopt/src/lower.mts',
    region: 'symbol:regoStringArray',
    expected: 'e11dedd9cf81a3cc70a76cb557b048131396bdb853b9ec831e2fab1a37160b93',
    why: 'every Rego array literal in the emitted policy (globs, markers, patterns) is written by this function.',
  },
];

export interface ByteIdentityRow {
  path: string;
  region: ByteIdentityRegion;
  expected: string;
  actual: string | null;
  eq: boolean;
  /**
   * (fold 1 F10) The owner's benignity statement when `eq` is false and the symbol
   * is on `EXPECTED_DELTAS`; `null` otherwise. A row with `eq: false` and
   * `disclosed: null` REFUSES the run.
   */
  disclosed: string | null;
}

/** Read one row's region out of the working tree and digest it. */
function actualDigest(pin: ByteIdentityPin): string | null {
  const abs = path.join(REPO_ROOT, ...pin.path.split('/'));
  if (!fs.existsSync(abs)) return null;
  if (pin.region === 'file') return sha256(fs.readFileSync(abs));
  const text = fs.readFileSync(abs, 'utf-8');
  const region =
    pin.region === 'section:[opa]'
      ? extractOpaSection(text)
      : extractSymbolRegion(text, pin.region.slice('symbol:'.length));
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
    const eq = actual === p.expected;
    const symbol = p.region.startsWith('symbol:') ? p.region.slice('symbol:'.length) : null;
    const declared = symbol === null ? undefined : EXPECTED_DELTAS[symbol];
    // (fold 2 H5) Disclosure is only ever READ here — the string is the owner's,
    // authored above — and it holds for ONE digest pair. A delta with no statement
    // beside it, or one whose measured digest is not the digest the statement was
    // written about, is not disclosed: it is a delta, and it refuses.
    const disclosed =
      eq || declared === undefined || declared.expected !== p.expected || declared.actual !== actual
        ? null
        : declared.reason;
    return { path: p.path, region: p.region, expected: p.expected, actual, eq, disclosed };
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

/**
 * (fold 1 F1) The COMMENT-STRIPPED digest of the K3 capture, under the charter's
 * own formula (`operations/310-seed20-target-preregistration.md:80`).
 *
 * Published as `manifest.k3Capture.policyRegoCodeSha256`, and asserted there against
 * the value the apparatus recomputes from the capture bytes every run. It is NOT in
 * `K3_CAPTURE_SHA256` because that map is keyed by spike-relative PATH and every
 * entry is a whole-file digest the manifest re-measures with `spikeFileDigest` — a
 * derived-text digest under a path key would be read as a file digest by the loop
 * that iterates it.
 *
 * Computed by the build leg over `seed/controls/k3/k3-target.policy.rego` with
 * `policyRegoCodeText` below. The pre-fold extractor also dropped blank lines and
 * appended a newline and produced `9190876ae2db5786…`, which is not the number the
 * charter's `score.mjs` will compute.
 */
export const K3_CAPTURE_POLICY_CODE_SHA256 =
  '0f8223c74c1cc5560cfbfcb7c86590490eef3f6e269677c136ca0bcc0ce08e7b';

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
 * The § 5 COMMENT-STRIPPED form of a published `policy.rego`, VERBATIM from the
 * charter (`mmnto-ai/totem-strategy:operations/310-seed20-target-preregistration.md:80`):
 *
 *   codeLines = emitted.split('\n').filter((l) => !l.trimStart().startsWith('#'))
 *
 * joined by `\n`. Nothing else: NO blank-line filter and NO trailing newline. The
 * digest `score.mjs` computes on the other side of the seam is sha256 (UTF-8) over
 * exactly this string, and a formula that differs by one byte produces a number that
 * agrees with nothing (fold 1 F1 — the pre-fold extractor dropped blank lines and
 * appended `\n`, and measured `9190876a…` where the charter measures `0f8223c7…`).
 *
 * Published as `manifest.k3Capture.policyRegoCodeSha256`, so the digest the
 * charter's § 5 asks for is the apparatus's own claim, re-derived every run, rather
 * than a number computed once by hand beside it.
 */
export function policyRegoCodeText(policyRego: string): string {
  return policyRego
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n');
}
