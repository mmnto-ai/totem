/**
 * `installed-packs.json` writer (mmnto-ai/totem#1768, Step 4).
 *
 * Walks two source surfaces — the consumer's `package.json` dependencies
 * for `@totem/pack-*` entries, and the consumer's `totem.config.ts`
 * `extends` array — deduplicates, resolves each pack's installed path
 * via npm/pnpm semantics, and writes `.totem/installed-packs.json` for
 * `pack-discovery.ts:loadInstalledPacks()` to consume at boot.
 *
 * Mismatch handling (ADR-097 § 5 Q4 + Open Question 4 disposition):
 * - In both surfaces: union, no warning.
 * - In `extends` only (declared but not resolvable via npm): emit a
 *   warning naming the pack; skip from the manifest. Consumer must
 *   `pnpm add` the pack to make it work.
 * - In `package.json` only (resolvable but not declared in extends):
 *   emit a warning; skip from the manifest. Pack-merge only consumes
 *   `extends`-declared packs; including the dep-only entry would be
 *   misleading.
 *
 * Atomic write semantics: the writer goes through a temp file +
 * rename, mirroring `writeReviewExtensionsFile` (mmnto-ai/totem#1527).
 *
 * Filesystem access happens at the CLI boundary (this module is invoked
 * by `syncCommand`); the resolver itself takes paths + content as
 * inputs so tests can drive it without disk I/O.
 */

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

import type { TotemConfig } from './config-schema.js';
import type { InstalledPacksManifest } from './pack-discovery.js';

// ─── Types ──────────────────────────────────────────

export interface PackResolutionWarning {
  /** Pack name surfaced in the warning. */
  readonly name: string;
  /**
   * Why the pack didn't make it to the manifest. Two shapes:
   *
   * - `dep-only`: present in package.json but not declared in
   *   `totem.config.ts` `extends`. Skipped because pack-merge only
   *   consumes `extends`-declared packs.
   * - `extends-only`: declared in `extends` but not installed
   *   (`require.resolve` failed). Skipped because the engine cannot
   *   load it.
   * - `not-a-pack`: present somewhere but doesn't expose a `register`
   *   callback (default export or named `register` function). Skipped
   *   because pack-discovery would throw on first attempt.
   */
  readonly reason: 'dep-only' | 'extends-only' | 'not-a-pack';
}

export interface PackResolutionResult {
  /** Packs that landed in the manifest (sorted by name). */
  readonly resolved: InstalledPacksManifest['packs'];
  /** Per-pack warnings for the consumer (sorted by name). */
  readonly warnings: readonly PackResolutionWarning[];
}

export interface ResolveInstalledPacksInput {
  /** Project root (where `package.json` lives). */
  readonly projectRoot: string;
  /** Loaded totem config (read for `extends`). */
  readonly config: TotemConfig;
  /**
   * Optional override for the package.json read. Tests pass a synthetic
   * dependencies map; production callers leave it undefined and the
   * function reads `<projectRoot>/package.json`.
   */
  readonly packageJsonDeps?: Readonly<Record<string, string>>;
  /**
   * Optional override for the require resolver. Tests stub this to
   * resolve fixture packs without writing to `node_modules`; production
   * callers use the default which delegates to `createRequire`.
   */
  readonly resolvePackPath?: (name: string, fromDir: string) => string | undefined;
}

// ─── Resolver ───────────────────────────────────────

const PACK_NAME_PREFIX = '@totem/pack-';

/**
 * Compute the deduplicated union of `package.json` `@totem/pack-*` deps
 * and `totem.config.ts` `extends` entries. Returns the manifest payload
 * shape ready for `installed-packs.json` plus per-pack warnings for any
 * surface mismatch.
 *
 * Pure function — no filesystem write. The CLI integration calls
 * `writeInstalledPacksManifest()` to persist.
 */
export function resolveInstalledPacks(input: ResolveInstalledPacksInput): PackResolutionResult {
  const deps = input.packageJsonDeps ?? readPackageJsonDeps(input.projectRoot);
  const extendsList = (input.config.extends ?? []).filter(
    (name) => name.startsWith(PACK_NAME_PREFIX), // totem-context: `extends` is z.string() per TotemConfigSchema — entries are guaranteed strings, not fileGlobs union members
  );
  const depPackNames = Object.keys(deps).filter((name) => name.startsWith(PACK_NAME_PREFIX)); // totem-context: Object.keys() returns strings; not fileGlobs ast-grep object form

  const extendsSet = new Set(extendsList);
  const depsSet = new Set(depPackNames);
  const union = new Set<string>([...extendsSet, ...depsSet]);

  const warnings: PackResolutionWarning[] = [];
  const resolved: InstalledPacksManifest['packs'] = [];

  for (const name of [...union].sort()) {
    if (!extendsSet.has(name)) {
      // Resolvable dep that the consumer hasn't opted into via `extends`.
      // Pack-merge only consumes extends-declared packs, so this pack
      // would never have its rules merged anyway. Skip with a warning.
      warnings.push({ name, reason: 'dep-only' });
      continue;
    }
    if (!depsSet.has(name)) {
      // Declared in extends but not installed via package manager.
      // Cannot resolve a path; skip with a warning.
      warnings.push({ name, reason: 'extends-only' });
      continue;
    }

    const resolver = input.resolvePackPath ?? defaultResolvePackPath;
    const resolvedPath = resolver(name, input.projectRoot);
    if (!resolvedPath) {
      warnings.push({ name, reason: 'extends-only' });
      continue;
    }

    const declaredEngineRange = readPeerEngineRange(resolvedPath);
    if (!declaredEngineRange) {
      warnings.push({ name, reason: 'not-a-pack' });
      continue;
    }

    resolved.push({
      name,
      resolvedPath,
      declaredEngineRange,
    });
  }

  return { resolved, warnings };
}

/**
 * Atomically write `<totemDir>/installed-packs.json` with the given
 * manifest payload. Mirrors `writeReviewExtensionsFile` semantics: temp
 * file + rename so a concurrent boot-time read sees the old or new
 * contents, never a partial write.
 */
export function writeInstalledPacksManifest(
  totemDirAbs: string,
  manifest: InstalledPacksManifest,
): string {
  if (!fs.existsSync(totemDirAbs)) {
    fs.mkdirSync(totemDirAbs, { recursive: true });
  }
  const finalPath = path.join(totemDirAbs, 'installed-packs.json');
  const tmpPath = finalPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmpPath, finalPath);
  return finalPath;
}

// ─── Internal helpers ───────────────────────────────

function readPackageJsonDeps(projectRoot: string): Record<string, string> {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return {};
  let parsed: unknown;
  // totem-context: intentional cleanup — package.json missing/corrupt is non-fatal to sync; treat as no deps
  try {
    parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')); // totem-context: sync read at boot; sync command is itself synchronous CLI top-level
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};
  const obj = parsed as { dependencies?: unknown; devDependencies?: unknown };
  const out: Record<string, string> = {};
  for (const field of ['dependencies', 'devDependencies'] as const) {
    const section = obj[field];
    if (typeof section !== 'object' || section === null) continue;
    for (const [name, value] of Object.entries(section as Record<string, unknown>)) {
      if (typeof value === 'string') out[name] = value;
    }
  }
  return out;
}

function defaultResolvePackPath(name: string, fromDir: string): string | undefined {
  // We resolve from the project root rather than from this module — packs
  // live in the consumer's node_modules, not core's.
  const require = createRequire(path.join(fromDir, 'package.json'));
  try {
    // Resolve to the package's package.json so the directory containing it
    // is the pack's package root. require.resolve(name) would land on the
    // package's `main` entry, which isn't what pack-discovery wants.
    const pkgJsonPath = require.resolve(`${name}/package.json`);
    return path.dirname(pkgJsonPath); // totem-context: intentional cleanup — unresolvable pack returns undefined to flow into the `extends-only` warning path
  } catch {
    return undefined;
  }
}

function readPeerEngineRange(packResolvedPath: string): string | undefined {
  const pkgPath = path.join(packResolvedPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return undefined;
  let parsed: unknown;
  // totem-context: intentional cleanup — corrupted pack package.json returns undefined to flow into the `not-a-pack` warning path
  try {
    parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')); // totem-context: sync read at boot; sync command is itself synchronous CLI top-level
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const peer = (parsed as { peerDependencies?: unknown }).peerDependencies; // totem-context: parsed was narrowed via `typeof !== 'object' || === null` guard above; the cast is for index access into already-validated JSON
  if (typeof peer !== 'object' || peer === null) return undefined;
  const range = (peer as Record<string, unknown>)['@mmnto/totem']; // totem-context: peer was narrowed via `typeof !== 'object' || === null` guard above; the cast is for index access; result is runtime-checked via `typeof range === 'string'` below
  return typeof range === 'string' ? range : undefined;
}
