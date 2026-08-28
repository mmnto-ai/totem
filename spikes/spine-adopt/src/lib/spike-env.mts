// ─── Shared spike environment: repo paths + the P5 dist-barrel import seam ────
//
// § Oracle arms / "Import path (P5 ruling)": the harness file-URL-imports the
// BUILT `packages/core/dist/index.js`. `@mmnto/totem` is not root-linked and deep
// imports are exports-blocked, so this is the only seam that reaches the shipped
// dispatchers without mutating any workspace or package config.

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

export function writeArtifact(relPath: string, value: unknown): string {
  const abs = path.join(ARTIFACTS_DIR, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
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
