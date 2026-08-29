// ─── Shared spike environment: repo paths + the P5 dist-barrel import seam ────
//
// § Oracle arms / "Import path (P5 ruling)": the harness file-URL-imports the
// BUILT `packages/core/dist/index.js`. `@mmnto/totem` is not root-linked and deep
// imports are exports-blocked, so this is the only seam that reaches the shipped
// dispatchers without mutating any workspace or package config.

import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `spikes/spine-adopt/` */
export const SPIKE_ROOT = path.resolve(HERE, '..', '..');
/** The worktree root (the repo the corpora and fixtures live in). */
export const REPO_ROOT = path.resolve(SPIKE_ROOT, '..', '..');

export const ARTIFACTS_DIR = path.join(SPIKE_ROOT, 'artifacts');
export const FACTS_DIR = path.join(ARTIFACTS_DIR, 'facts');
export const RECORDS_DIR = path.join(SPIKE_ROOT, 'records');
export const TOOLS_DIR = path.join(SPIKE_ROOT, 'tools');

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
/** `artifacts/tracked-paths.txt` — the sorted `git ls-files` sweep set the manifest hashes. */
export const TRACKED_PATHS_ARTIFACT = 'tracked-paths.txt';

export function sha256(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * The run-manifest digest, over the manifest's STABLE core.
 *
 * `bundles[]` is filled in after `src/facts.mts` runs, so hashing the whole file
 * would give the artifacts written before facts a different manifest identity from
 * the ones written after — one run, two manifest hashes, and no way to tell which
 * an artifact meant. The digest is therefore taken over the manifest with
 * `bundles` and the digest field itself removed, serialised exactly the way
 * `writeArtifact` serialises. `src/manifest.mts` stores the result IN the manifest,
 * so a consumer reads the value rather than re-deriving it.
 */
export function computeRunManifestSha256(manifest: Record<string, unknown>): string {
  const core = { ...manifest };
  delete core.bundles;
  delete core.runManifestSha256;
  return sha256(`${JSON.stringify(core, null, 2)}\n`);
}

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
 * Fill the manifest's `bundles[]` (§ G5: "filled after facts").
 *
 * The digest is NOT recomputed: `bundles` is outside its preimage precisely so
 * that this update cannot move the identity artifacts written earlier in the run
 * already committed to. Asserted rather than assumed — a drift here would mean two
 * artifacts in one run claim different manifests.
 */
export function fillManifestBundles(bundles: { fixtureId: string; sha256: string }[]): string {
  const m = readRunManifest();
  const next = { ...m, bundles };
  const recomputed = computeRunManifestSha256(next);
  if (recomputed !== m.runManifestSha256) {
    throw new Error(
      `filling manifest.bundles MOVED the run-manifest digest (${String(m.runManifestSha256).slice(0, 16)}… -> ${recomputed.slice(0, 16)}…); ` +
        `the digest preimage must exclude \`bundles\`.`,
    );
  }
  manifestCache = next;
  const abs = path.join(ARTIFACTS_DIR, MANIFEST_ARTIFACT);
  fs.writeFileSync(abs, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return abs;
}

/**
 * Write an artifact, STAMPED with the run-manifest digest (§ G5, "every later
 * artifact embeds it"). The manifest itself is written unstamped — it is the
 * referent — and a non-object payload is passed through untouched.
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
    ? { ...(value as Record<string, unknown>), runManifestSha256: runManifestSha256() }
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
