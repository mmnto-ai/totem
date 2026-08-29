// ─── Shared spike environment: repo paths + the P5 dist-barrel import seam ────
//
// § Oracle arms / "Import path (P5 ruling)": the harness file-URL-imports the
// BUILT `packages/core/dist/index.js`. `@mmnto/totem` is not root-linked and deep
// imports are exports-blocked, so this is the only seam that reaches the shipped
// dispatchers without mutating any workspace or package config.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `spikes/spine-adopt/` */
export const SPIKE_ROOT = path.resolve(HERE, '..', '..');
/** The worktree root (the repo the corpora and fixtures live in). */
export const REPO_ROOT = path.resolve(SPIKE_ROOT, '..', '..');

// ─── C10 — `SPIKE_ARTIFACTS_SUBDIR`, one artifact set per named run ──────────

/**
 * `SPIKE_ARTIFACTS_SUBDIR=<name>` moves BOTH output roots one level down:
 * `artifacts/<name>/…` and `rego/build/<name>/…`. Unset ⇒ today's paths,
 * byte-for-byte — every existing run, artifact and check is untouched.
 *
 * It exists because the K-controls need a SECOND, complete artifact set beside
 * the run of record (K4's swapped-examples run, K7's rebuild, K3's control-only
 * re-pin build), and a control that overwrote the run it is a control FOR would
 * destroy its own referent. The Go arm reads the same variable and applies it to
 * its input root and its output dir, so the two languages address one set.
 *
 * VALIDATED `^[a-z0-9-]+$`: the value becomes a path segment, so `..`, an
 * absolute path or a separator would escape the artifact tree.
 */
function readArtifactsSubdir(): string | null {
  const raw = process.env.SPIKE_ARTIFACTS_SUBDIR;
  if (raw === undefined || raw === '') {
    // (§ S5) The control-only re-pin build DEFAULTS to `k3-control`. Without a
    // default it would publish into the run of record's own roots and wipe the
    // chains it exists to be a control for — `src/build-wasm.mts` removes
    // `artifacts/chains/` at the start of every build. Read from the environment
    // directly rather than through `activeRecordSet()`: `src/lib/record-sets.mts`
    // imports THIS module, so calling into it here would close a cycle.
    const control = process.env.SPIKE_CONTROL_RECORD;
    return control === undefined || control === '' ? null : 'k3-control';
  }
  if (!/^[a-z0-9-]+$/.test(raw)) {
    throw new Error(
      `SPIKE_ARTIFACTS_SUBDIR=${JSON.stringify(raw)} is not a valid artifact subdirectory name; ` +
        'expected `^[a-z0-9-]+$` (it becomes one path segment under `artifacts/` and `rego/build/`).',
    );
  }
  return raw;
}

/** The active artifact subdirectory, or `null` when unset. Recorded in the manifest. */
export const ARTIFACTS_SUBDIR: string | null = readArtifactsSubdir();

export const ARTIFACTS_DIR = path.join(
  SPIKE_ROOT,
  'artifacts',
  ...(ARTIFACTS_SUBDIR === null ? [] : [ARTIFACTS_SUBDIR]),
);
export const FACTS_DIR = path.join(ARTIFACTS_DIR, 'facts');
/** `artifacts/chains/` — the published certificates (`src/certify.mts` is the only writer). */
export const CHAINS_DIR = path.join(ARTIFACTS_DIR, 'chains');
/** `artifacts/blocked/` — a blocked bundle's typed reason, and no chain. */
export const BLOCKED_DIR = path.join(ARTIFACTS_DIR, 'blocked');
/**
 * G7 — the PUBLISHED lowering. `rego/build/` stays a gitignored build tree; the
 * policy and its glob table are copied here so T3 can audit the lowering from the
 * repository at the pin without rebuilding it.
 * `<pkg>` is the package SUFFIX (`totem.spike.` stripped) — the same key the build
 * tree and `artifacts/chains/<pkg>.json` already use.
 */
export const LOWERED_PUBLISH_DIR = path.join(ARTIFACTS_DIR, 'lowered');
export const RECORDS_DIR = path.join(SPIKE_ROOT, 'records');
export const TOOLS_DIR = path.join(SPIKE_ROOT, 'tools');
export const REGO_DIR = path.join(SPIKE_ROOT, 'rego');
/** The gitignored build tree, subdir-aware like `ARTIFACTS_DIR` (C10). */
export const REGO_BUILD_DIR = path.join(
  REGO_DIR,
  'build',
  ...(ARTIFACTS_SUBDIR === null ? [] : [ARTIFACTS_SUBDIR]),
);

/**
 * Platform-aware pinned-tool resolution (day-14 "build matrix Windows+Linux").
 *
 * Precedence: `$<envVar>` (absolute path to the binary, how CI points at its own
 * tools dir) → the per-platform default under `TOOLS_DIR`. Both defaults name the
 * asset pinned in `toolchain.lock`; on win32 with no env set this is byte-identical
 * to the original hardcoded path.
 */
function resolveTool(envVar: string, windowsRel: string, posixRel: string): string {
  const override = process.env[envVar];
  if (override !== undefined && override !== '') return override;
  return path.join(TOOLS_DIR, process.platform === 'win32' ? windowsRel : posixRel);
}

export const OPA_BIN = resolveTool(
  'SPIKE_OPA_BIN',
  'opa_windows_amd64.exe',
  'opa_linux_amd64_static',
);

export const CORE_DIST_BARREL = path.join(REPO_ROOT, 'packages', 'core', 'dist', 'index.js');

/** The four shipped rule corpora, in census order. */
export const CORPORA = [
  { id: 'root', file: path.join(REPO_ROOT, '.totem', 'compiled-rules.json') },
  {
    id: 'pack-agent-security',
    file: path.join(REPO_ROOT, 'packages', 'pack-agent-security', 'compiled-rules.json'),
  },
  {
    id: 'pack-agent-workflow',
    file: path.join(REPO_ROOT, 'packages', 'pack-agent-workflow', 'compiled-rules.json'),
  },
  {
    id: 'pack-rust-architecture',
    file: path.join(REPO_ROOT, 'packages', 'pack-rust-architecture', 'compiled-rules.json'),
  },
] as const;

/**
 * Import the built core barrel. Fails LOUD (Tenet 4) with the exact build command
 * when the dist is absent — a silently-skipped harness is the failure mode this
 * spike exists to avoid.
 */
export async function loadCoreBarrel(): Promise<Record<string, any>> {
  if (!fs.existsSync(CORE_DIST_BARREL)) {
    throw new Error(
      `core dist barrel missing at ${CORE_DIST_BARREL} — run \`pnpm -r build\` from ${REPO_ROOT} first (spec § Oracle arms, P5 ruling).`,
    );
  }
  return (await import(pathToFileURL(CORE_DIST_BARREL).href)) as Record<string, any>;
}

/** Assert a symbol is on the barrel before use, so a missing export is loud, not `undefined is not a function`. */
export function requireSymbols(mod: Record<string, any>, names: readonly string[]): void {
  const missing = names.filter((n) => mod[n] === undefined);
  if (missing.length > 0) {
    throw new Error(`core dist barrel is missing required symbols: ${missing.join(', ')}`);
  }
}

// ─── The run manifest (spec `.totem/specs/seed20-apparatus.md` § G5) ─────────

/** `artifacts/manifest.json`, written FIRST by `src/manifest.mts` (step 0 of `all`). */
export const MANIFEST_ARTIFACT = 'manifest.json';
export const MANIFEST_FILE = path.join(ARTIFACTS_DIR, MANIFEST_ARTIFACT);
/** `artifacts/tracked-paths.txt` — the sorted `git ls-tree -r --name-only HEAD` sweep set the manifest hashes (T17: the tree at `runCommit`, never the index). */
export const TRACKED_PATHS_ARTIFACT = 'tracked-paths.txt';
/**
 * `artifacts/tracked-paths-at-record-pin.txt` — the sorted tree at the RECORD PIN
 * (§ S6), which is the T5 sweep set. Distinct from `tracked-paths.txt`: that one is
 * the tree at `runCommit` (T17 provenance), this one is the corpus T5 sweeps.
 */
export const TRACKED_PATHS_AT_RECORD_PIN_ARTIFACT = 'tracked-paths-at-record-pin.txt';

export function sha256(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * TWO digests, because the run has two identities and one of them is not knowable
 * until the facts exist (mmnto-ai/totem#2694, T15).
 *
 * `runManifestSha256` is the PRE-FACTS identity: which record set, which commit,
 * which record bytes, which toolchain, which machine. `bundles[]` is filled in
 * after `src/facts.mts` runs, so hashing the whole file would give the artifacts
 * written before facts a different manifest identity from the ones written after —
 * one run, two manifest hashes, and no way to tell which an artifact meant. The
 * digest is therefore taken over the manifest with `bundles`, `bundlesSha256` and
 * the digest field itself removed, serialised exactly the way `writeArtifact`
 * serialises. `src/manifest.mts` stores the result IN the manifest, so a consumer
 * reads the value rather than re-deriving it.
 *
 * That stability is exactly why it is NOT a complete identity: ONE manifest can
 * be filled with different bundle sets (a `SPIKE_SWAP_EXAMPLES` re-run of facts,
 * a hand-edited bundle, a partial facts run) and every one of them would carry the
 * same `runManifestSha256`; a reader propagating the stored digest could not tell
 * them apart. (Two ORDINARY runs already differ — `generatedAt` and `runCommit`
 * are in the preimage — so the gap is per-manifest, not per-run.) `bundlesSha256`
 * (below) closes it without moving the pre-facts identity: it is computed when
 * `bundles[]` is filled, and every artifact written AFTER facts embeds BOTH.
 * What the digest attests is the bundle set the FACTS STAGE WROTE; that the arms
 * then read those exact bytes is a separate claim, re-verified by the comparator
 * (`src/compare.mts` re-hashes every bundle on disk against `manifest.bundles`
 * before it compares anything — round-1 falsification leg, M3).
 * Artifacts written BEFORE facts (`manifest.json` itself,
 * `expressibility-census.json`, `records-verification.json`) embed only the
 * pre-facts digest — they made no claim about fact bytes.
 */
export function computeRunManifestSha256(manifest: Record<string, unknown>): string {
  const core = { ...manifest };
  delete core.bundles;
  delete core.bundlesSha256;
  delete core.runManifestSha256;
  // (fold 3 J1, `.totem/specs/seed20-apparatus-slice2-fold3.md`) EXACTLY these three
  // keys, and never a fourth. This function is not free to choose its preimage: the
  // scorer re-derives `runManifestSha256` on its own side by deleting `bundles`,
  // `bundlesSha256` and the digest field, and refuses the run on any mismatch
  // (charter mmnto-ai/totem-strategy#1154 § 5). Fold 2's H6 deleted `checks` here as
  // well and published the rows INSIDE the manifest — which would have made every run
  // of record refuse, because the scorer's `core` still carries them. The rows now
  // live in the sibling artifact `artifacts/manifest-checks.json` (`src/manifest.mts`),
  // so the manifest the scorer hashes and the manifest this apparatus hashes are the
  // same object.
  return sha256(`${JSON.stringify(core, null, 2)}\n`);
}

/**
 * The BUNDLE-SET digest: sha256 over the canonical JSON of the SORTED bundle list.
 *
 * Canonical here means: each entry reduced to `{fixtureId, sha256}` in that key
 * order, the list ordered by `fixtureId` then `sha256` (so a producer's emission
 * order cannot move the digest), serialised with the same two-space + trailing
 * newline form `computeRunManifestSha256` and `writeArtifact` use.
 */
export function computeBundlesSha256(bundles: { fixtureId: string; sha256: string }[]): string {
  const canonical = bundles
    .map((b) => ({ fixtureId: b.fixtureId, sha256: b.sha256 }))
    // Codepoint order, never `localeCompare`: this is a cross-machine identity,
    // and locale collation can reorder mixed-case ids between hosts (round-1
    // falsification leg, m4).
    .sort((a, b) =>
      a.fixtureId < b.fixtureId
        ? -1
        : a.fixtureId > b.fixtureId
          ? 1
          : a.sha256 < b.sha256
            ? -1
            : a.sha256 > b.sha256
              ? 1
              : 0,
    );
  return sha256(`${JSON.stringify(canonical, null, 2)}\n`);
}

/**
 * The artifacts written AFTER `src/facts.mts` — the ones whose content depends on
 * the evaluated fact bytes, and which therefore carry BOTH digests (T15).
 *
 * Named here rather than inferred from run order so that adding an artifact to the
 * pipeline is a decision taken in one place: a `writeArtifact` artifact not on this
 * list is stamped with the pre-facts digest only, and one that IS on it cannot be
 * written before the bundle set exists (`writeArtifact` refuses). The published
 * certificates (`artifacts/chains/*.json`, `artifacts/blocked/*.json`) bypass
 * `writeArtifact` entirely and carry NEITHER digest — required, not an omission:
 * their bytes are held to equality with the committed set (K3, INV 2).
 */
export const POST_FACTS_ARTIFACTS: readonly string[] = [
  'facts-index.json',
  'shipped-verdicts.json',
  'lowering-rejects.json',
  'opa-abi-census.json',
  'chain-inputs.json',
  'certification-report.json',
  'certification-invariants.json',
  'differential-report.json',
  // § S6 — the T5 sweep reads the lowered policies of a run whose fact bytes are
  // already fixed, and § S7's controls summarise artifacts written after facts.
  't5-sweep.json',
  'controls.json',
];

let manifestCache: Record<string, unknown> | null = null;

/** The run manifest, read once per process. FAILS LOUD with the command to run. */
export function readRunManifest(): Record<string, unknown> {
  if (manifestCache) return manifestCache;
  if (!fs.existsSync(MANIFEST_FILE)) {
    throw new Error(
      `${MANIFEST_FILE} is missing — run \`npm run manifest\` first (it is step 0 of \`npm run all\`; ` +
        `every artifact this pipeline writes is bound to it).`,
    );
  }
  const m = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf-8')) as Record<string, unknown>;
  if (typeof m.runManifestSha256 !== 'string') {
    throw new Error(
      `${MANIFEST_FILE} carries no \`runManifestSha256\` — re-run \`npm run manifest\`.`,
    );
  }
  manifestCache = m;
  return m;
}

/**
 * The digest every artifact this pipeline writes is stamped with.
 *
 * NAMED `runManifestSha256`, not `manifestSha256`, DELIBERATELY: `manifestSha256`
 * is already bound in this apparatus to the OPA bundle's ENTRYPOINT/IMPORT manifest
 * digest — it is a published key of every `artifacts/chains/*.json`, one of the
 * five members `src/certify-verify.mts` INV 2 binds, and the marker that file uses
 * to choose its comparison mode. Reusing the spelling would put two different
 * digests under one key in the same artifact. Flagged for the dispatching seat:
 * reversible in one place (this function's key name plus `src/manifest.mts`).
 */
export function runManifestSha256(): string {
  return readRunManifest().runManifestSha256 as string;
}

/**
 * The bundle-set digest, for the artifacts written after facts. FAILS LOUD when it
 * is absent (T15): a post-facts artifact that silently dropped the field would
 * carry the pre-facts identity alone, which is precisely the identity gap this
 * digest exists to close.
 */
export function bundlesSha256(forArtifact: string): string {
  const m = readRunManifest();
  if (typeof m.bundlesSha256 !== 'string' || m.bundlesSha256.length === 0) {
    throw new Error(
      `${forArtifact} is written AFTER facts and must embed \`bundlesSha256\`, but ${MANIFEST_FILE} ` +
        `carries none (value: ${JSON.stringify(m.bundlesSha256)}) — \`src/facts.mts\` fills it when it fills ` +
        `\`bundles[]\`, so run \`npm run facts\` (or \`npm run all\`) before this stage.`,
    );
  }
  return m.bundlesSha256;
}

/**
 * Fill the manifest's `bundles[]` and compute `bundlesSha256` (§ G5: "filled after
 * facts"; T15: the bundle set is part of the run's identity).
 *
 * `runManifestSha256` is NOT recomputed: `bundles` is outside its preimage
 * precisely so that this update cannot move the identity artifacts written earlier
 * in the run already committed to. Asserted rather than assumed — a drift here
 * would mean two artifacts in one run claim different manifests. `bundlesSha256`
 * is outside that preimage for the same reason, and carries the fact bytes instead.
 */
export function fillManifestBundles(bundles: { fixtureId: string; sha256: string }[]): string {
  const m = readRunManifest();
  const next = { ...m, bundles, bundlesSha256: computeBundlesSha256(bundles) };
  // (fold 3 J1) Fold 2's `checks`-survival guard is GONE with the key it guarded: the
  // manifest stage's rows are published as `artifacts/manifest-checks.json`, which this
  // function does not touch, and the guard could not fail in any case (the spread two
  // lines up is what it asserted about).
  const recomputed = computeRunManifestSha256(next);
  if (recomputed !== m.runManifestSha256) {
    throw new Error(
      `filling manifest.bundles MOVED the run-manifest digest (${String(m.runManifestSha256).slice(0, 16)}… -> ${recomputed.slice(0, 16)}…); ` +
        `the digest preimage must exclude \`bundles\` and \`bundlesSha256\`.`,
    );
  }
  manifestCache = next;
  const abs = path.join(ARTIFACTS_DIR, MANIFEST_ARTIFACT);
  fs.writeFileSync(abs, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return abs;
}

/**
 * Write an artifact, STAMPED with the run's identity (§ G5, "every later artifact
 * embeds it"; T15, "and the bundle set it was evaluated against").
 *
 * Every stamped artifact carries `runManifestSha256`; the ones on
 * `POST_FACTS_ARTIFACTS` carry `bundlesSha256` beside it and REFUSE to be written
 * without it. The manifest itself is written unstamped — it is the referent — and a
 * non-object payload is passed through untouched.
 */
export function writeArtifact(relPath: string, value: unknown): string {
  const abs = path.join(ARTIFACTS_DIR, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const stampable =
    relPath !== MANIFEST_ARTIFACT &&
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
  const payload = stampable
    ? {
        ...(value as Record<string, unknown>),
        runManifestSha256: runManifestSha256(),
        ...(POST_FACTS_ARTIFACTS.includes(relPath)
          ? { bundlesSha256: bundlesSha256(relPath) }
          : {}),
      }
    : value;
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  return abs;
}

/** A tiny assertion harness: every check is recorded, and any failure ends the run non-zero. */
export class Checks {
  readonly rows: { name: string; ok: boolean; detail: string }[] = [];

  check(name: string, ok: boolean, detail = ''): void {
    this.rows.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  }

  eq(name: string, actual: unknown, expected: unknown): void {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    this.check(name, a === e, a === e ? a : `expected ${e}, got ${a}`);
  }

  get failures(): { name: string; ok: boolean; detail: string }[] {
    return this.rows.filter((r) => !r.ok);
  }

  finish(label: string): void {
    const bad = this.failures;
    console.log(`\n${label}: ${this.rows.length - bad.length}/${this.rows.length} checks passed`);
    if (bad.length > 0) {
      for (const b of bad) console.error(`  FAILED: ${b.name} — ${b.detail}`);
      process.exitCode = 1;
      throw new Error(`${label}: ${bad.length} assertion(s) failed`);
    }
  }
}
