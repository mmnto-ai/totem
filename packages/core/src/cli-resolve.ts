/**
 * Resolve Totem's own CLI entry explicitly (mmnto-ai/totem#3008).
 *
 * One resolver for every caller that must run "the Totem CLI": the CLI's
 * prefer-local re-exec (`resolveLocalEntry`) and the MCP server's spawning
 * tools (`resolveTotemCli`). Tiers, first hit wins:
 *
 * 1. **Workspace build** — `packages/cli/dist/index.js`, identity-guarded on
 *    `packages/cli/package.json` naming `@mmnto/cli`, walking up.
 * 2. **Pinned install** — `node_modules/@mmnto/cli/dist/index.js`, walking up.
 * 3. **npm-layout global on PATH** — the two npm global layouts only, each
 *    identity-checked against its own `package.json`.
 *
 * Otherwise a refusal that names what was looked for. These tiers differ on
 * purpose from the git hooks' cascade (`buildResolveBlock` in the CLI's
 * install-hooks): a spawn inside a tool call runs unattended, with nobody at a
 * terminal to see what was fetched or run, so it stops at an identity-checked
 * local entry or npm-layout global and never falls back to a package manager
 * or the network.
 *
 * Light by contract: imports only `node:fs` and `node:path`, so it is also
 * exported as the `@mmnto/totem/cli-resolve` subpath for callers that must
 * not load the core barrel.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const VERSION_RE = /"version"\s*:\s*"([^"]+)"/;
const NAME_IS_CLI_RE = /"name"\s*:\s*"@mmnto\/cli"/;

const PACKAGES_DIR = 'packages';
const DIST_DIR = 'dist';
const NODE_MODULES_DIR = 'node_modules';
const ENTRY_FILE = 'index.js';
const PACKAGE_JSON = 'package.json';
const CLI_PACKAGE = 'cli';
const SCOPE_DIR = '@mmnto';
const BIN_NAME = 'totem';
/** Executable names a non-npm-layout `totem` may carry on PATH (reported, never run). */
const BIN_VARIANTS: readonly string[] = [
  BIN_NAME,
  `${BIN_NAME}.cmd`,
  `${BIN_NAME}.exe`,
  `${BIN_NAME}.ps1`,
];

/** Every filesystem read the resolver makes — a seam for tests. */
export interface CliResolveFs {
  exists(p: string): boolean;
  /** True for a regular file (a link to one counts); may throw on an unreadable path. */
  isFile(p: string): boolean;
  readText(p: string): string;
  realpath(p: string): string;
}

export const NODE_CLI_RESOLVE_FS: CliResolveFs = {
  exists: (p) => fs.existsSync(p),
  isFile: (p) => fs.statSync(p).isFile(),
  readText: (p) => fs.readFileSync(p, 'utf-8'),
  realpath: (p) => fs.realpathSync(p),
};

export interface LocalEntry {
  /** Absolute path to the local `dist/index.js`. */
  entry: string;
  /** The local install's version, when its package.json is readable. */
  version?: string;
  /** Which tier matched: the workspace build or the pinned dependency. */
  tier: 'workspace' | 'pinned';
}

export interface GlobalEntry {
  /** Absolute path to the global install's `dist/index.js`. */
  entry: string;
  /** The global install's version, when its package.json is readable. */
  version?: string;
  tier: 'global';
}

export interface GlobalProbe {
  hit?: GlobalEntry;
  /** Paths of a `totem` executable found on PATH that is not an npm-layout install of @mmnto/cli. */
  unverified: string[];
}

export type CliResolution =
  | {
      ok: true;
      entry: string;
      version?: string;
      tier: 'workspace' | 'pinned' | 'global';
      /**
       * Present on a global hit only, and only when a `totem` earlier on PATH
       * was skipped because it could not be verified: the CLI that runs is then
       * not the one the user's shell would run, and the caller can say so.
       */
      unverified?: string[];
    }
  | { ok: false; looked: string[]; unverified: string[] };

/** Probe-grade version read — no JSON.parse, no fail-open catch. */
function readVersion(pkgJsonPath: string, fsx: CliResolveFs): string | undefined {
  if (!fsx.exists(pkgJsonPath)) return undefined;
  return VERSION_RE.exec(fsx.readText(pkgJsonPath))?.[1];
}

/** True when `pkgJsonPath` exists and names `@mmnto/cli`. */
function namesCli(pkgJsonPath: string, fsx: CliResolveFs): boolean {
  return fsx.exists(pkgJsonPath) && NAME_IS_CLI_RE.test(fsx.readText(pkgJsonPath));
}

/**
 * Resolve the project-local CLI entry by walking up from `cwd`:
 *
 * 1. **Workspace-HEAD** — `packages/cli/dist/index.js`, identity-guarded on
 *    `packages/cli/package.json` declaring `@mmnto/cli` (the dogfood monorepo;
 *    the build you just made wins over any installed copy).
 * 2. **Pinned dependency** — `node_modules/@mmnto/cli/dist/index.js`, the
 *    project's version-locked install via the package's own entry point.
 *
 * Both tiers require the BUILT entry to exist. A read failure mid-walk throws;
 * the caller decides the posture.
 */
export function resolveLocalEntry(
  cwd: string,
  fsx: CliResolveFs = NODE_CLI_RESOLVE_FS,
): LocalEntry | undefined {
  let dir = path.resolve(cwd);
  for (;;) {
    const workspacePkg = path.join(dir, PACKAGES_DIR, CLI_PACKAGE, PACKAGE_JSON);
    const workspaceEntry = path.join(dir, PACKAGES_DIR, CLI_PACKAGE, DIST_DIR, ENTRY_FILE);
    if (fsx.exists(workspaceEntry) && namesCli(workspacePkg, fsx)) {
      return { entry: workspaceEntry, version: readVersion(workspacePkg, fsx), tier: 'workspace' };
    }

    const pinnedDir = path.join(dir, NODE_MODULES_DIR, SCOPE_DIR, CLI_PACKAGE);
    const pinnedEntry = path.join(pinnedDir, DIST_DIR, ENTRY_FILE);
    if (fsx.exists(pinnedEntry)) {
      return {
        entry: pinnedEntry,
        version: readVersion(path.join(pinnedDir, PACKAGE_JSON), fsx),
        tier: 'pinned',
      };
    }

    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Run one filesystem probe of the PATH scan; undefined when it throws. The
 * global tier never throws: a PATH directory with a dangling link, an
 * unreadable `package.json` or an unreadable entry is "not a hit" there, and
 * the scan moves on to the next directory. The local walk does not use this:
 * a read failure mid-walk throws, as it always has.
 */
function attempt<T>(probe: () => T): T | undefined {
  // totem-context: intentional probe — the catch below does not rethrow by
  // design (mmnto-ai/totem#3008): one unreadable PATH directory must not stop
  // the scan before a valid install later on PATH is tried.
  try {
    return probe();
    // totem-context: intentional degradation — see directive above the try; placed on the line before the catch keyword, where the rule reads it.
  } catch {
    return undefined;
  }
}

/** A global hit in one PATH directory, by the two npm layouts, or undefined. Never throws. */
function probeGlobalDir(dir: string, fsx: CliResolveFs): GlobalEntry | undefined {
  // (a) The win32 npm layout: `<prefix>/node_modules/@mmnto/cli` beside the shim.
  const packagedDir = path.join(dir, NODE_MODULES_DIR, SCOPE_DIR, CLI_PACKAGE);
  const packagedEntry = path.join(packagedDir, DIST_DIR, ENTRY_FILE);
  const packagedPkg = path.join(packagedDir, PACKAGE_JSON);
  if (fsx.exists(packagedEntry) && attempt(() => namesCli(packagedPkg, fsx)) === true) {
    return {
      entry: packagedEntry,
      version: attempt(() => readVersion(packagedPkg, fsx)),
      tier: 'global',
    };
  }

  // (b) The POSIX npm layout: `<bin>/totem` is a symlink to `<pkg>/dist/index.js`.
  const shim = path.join(dir, BIN_NAME);
  if (!fsx.exists(shim)) return undefined;
  const real = attempt(() => fsx.realpath(shim));
  if (real === undefined || !real.endsWith('.js') || !fsx.exists(real)) return undefined;
  const realPkg = path.join(path.dirname(path.dirname(real)), PACKAGE_JSON);
  if (attempt(() => namesCli(realPkg, fsx)) !== true) return undefined;
  return { entry: real, version: attempt(() => readVersion(realPkg, fsx)), tier: 'global' };
}

/**
 * Find an npm-layout global install of `@mmnto/cli` on PATH, first hit wins.
 * A `totem` FILE (a directory of that name is not one) found in a directory
 * that yields no hit is reported in `unverified` and never run. Never throws.
 */
export function resolveGlobalEntry(
  pathEnv: string | undefined,
  fsx: CliResolveFs = NODE_CLI_RESOLVE_FS,
): GlobalProbe {
  const unverified: string[] = [];
  for (const dir of (pathEnv ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const hit = probeGlobalDir(dir, fsx);
    if (hit !== undefined) return { hit, unverified };
    for (const name of BIN_VARIANTS) {
      const candidate = path.join(dir, name);
      if (fsx.exists(candidate) && attempt(() => fsx.isFile(candidate)) === true) {
        unverified.push(candidate);
        break;
      }
    }
  }
  return { unverified };
}

/**
 * Resolve the Totem CLI for an unattended spawn: the workspace build, then the
 * pinned install (both walking up from `startDir`), then an npm-layout global
 * on PATH. Otherwise `{ ok: false }` with the places looked and any `totem`
 * found on PATH that could not be verified.
 */
export function resolveTotemCli(
  startDir: string,
  opts?: { pathEnv?: string; fs?: CliResolveFs },
): CliResolution {
  const fsx = opts?.fs ?? NODE_CLI_RESOLVE_FS;
  const local = resolveLocalEntry(startDir, fsx);
  if (local !== undefined) return { ok: true, ...local };

  const globalProbe = resolveGlobalEntry(opts?.pathEnv ?? process.env.PATH, fsx);
  if (globalProbe.hit !== undefined) {
    return globalProbe.unverified.length > 0
      ? { ok: true, ...globalProbe.hit, unverified: globalProbe.unverified }
      : { ok: true, ...globalProbe.hit };
  }

  return {
    ok: false,
    looked: [
      `a workspace build at packages/cli/dist/index.js, walking up from ${startDir}`,
      `a pinned install at node_modules/@mmnto/cli/dist/index.js, walking up from ${startDir}`,
      'an npm-layout global install of @mmnto/cli on PATH',
    ],
    unverified: globalProbe.unverified,
  };
}
