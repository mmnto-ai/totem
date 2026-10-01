/**
 * Prefer-local re-exec at the CLI entrypoint (mmnto-ai/totem#2018 L1).
 *
 * Promotes the deterministic tiers of the ADR-072 resolve cascade (shipped
 * for git hooks in mmnto-ai/totem#2053) into the binary itself: when a
 * foreign totem — typically an ambient global install — starts inside a
 * project that carries its own `@mmnto/cli`, the entrypoint delegates to the
 * project-local build instead of running with the wrong dependency tree.
 * Tenet 14 (Never Tie Governance to Volatile State): the pinned local install
 * is deterministic; the PATH global is ambient. This forecloses both variants
 * of the recurring class — missing externalized peer SDKs (mmnto-ai/totem#2018)
 * and stale-version shadowing (mmnto-ai/totem#2053) — by making the wrong
 * binary unreachable from inside a workspace.
 *
 * The delegation is announced on stderr, never silent, and `TOTEM_NO_REEXEC=1`
 * opts out (it also rides the child environment as the loop guard, so a
 * pathological realpath mismatch can never re-exec recursively).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { sync as spawnSync } from 'cross-spawn';

const VERSION_RE = /"version"\s*:\s*"([^"]+)"/;
const NAME_IS_CLI_RE = /"name"\s*:\s*"@mmnto\/cli"/;

const PACKAGES_DIR = 'packages';
const SRC_DIR = 'src';
const DIST_DIR = 'dist';
const NODE_MODULES_DIR = 'node_modules';
const ENTRY_FILE = 'index.js';
const PACKAGE_JSON = 'package.json';
const CLI_PACKAGE = 'cli';
const CORE_PACKAGE = 'core';
/** Directory names the freshness walk never descends into. */
const SKIPPED_SOURCE_DIRS: ReadonlySet<string> = new Set([NODE_MODULES_DIR, DIST_DIR]);

type WorkspacePackage = typeof CLI_PACKAGE | typeof CORE_PACKAGE;
/** Judged in this order; the first stale package is the one reported. */
const JUDGED_PACKAGES: readonly WorkspacePackage[] = [CLI_PACKAGE, CORE_PACKAGE];

/**
 * How current a workspace build is against its source (mmnto-ai/totem#2934).
 * A sensor only: it shapes stderr, never the delegation.
 */
export interface WorkspaceFreshness {
  /** ISO instant of the cli dist entry's mtime — what the banner prints. */
  builtAt: string;
  /** Present iff a source file is newer than its package's dist entry. */
  stale?: { package: WorkspacePackage; sourceNewestAt: string; distBuiltAt: string };
}

export interface LocalEntry {
  /** Absolute path to the local `dist/index.js` to delegate to. */
  entry: string;
  /** The local install's version, when its package.json is readable. */
  version?: string;
  /** Which cascade tier matched: workspace-HEAD or the pinned dependency. */
  tier: 'workspace' | 'pinned';
  /**
   * Workspace tier only, and only when the probe could read the trees. The
   * pinned tier never carries it: npm tarballs ship fixed mtimes, so an mtime
   * read there would say nothing true.
   */
  freshness?: WorkspaceFreshness;
}

/** The two filesystem reads the freshness probe makes — a seam for tests. */
export interface FreshnessFs {
  stat(p: string): { mtimeMs: number };
  readdir(p: string): fs.Dirent[];
}

const NODE_FRESHNESS_FS: FreshnessFs = {
  stat: (p) => fs.statSync(p),
  readdir: (p) => fs.readdirSync(p, { withFileTypes: true }),
};

export interface ResolveOptions {
  /** Overrides the freshness probe's filesystem reads (tests). */
  freshnessFs?: FreshnessFs;
  /** Rethrow a freshness-probe failure instead of dropping the sensor. */
  debug?: boolean;
}

/** Probe-grade version read — no JSON.parse, no fail-open catch. */
function readVersion(pkgJsonPath: string): string | undefined {
  if (!fs.existsSync(pkgJsonPath)) return undefined;
  return VERSION_RE.exec(fs.readFileSync(pkgJsonPath, 'utf-8'))?.[1];
}

/** Newest mtime (ms) of any file under `dir`, skipping `node_modules` and `dist`. */
function newestSourceMtimeMs(dir: string, fsx: FreshnessFs): number | undefined {
  let newest: number | undefined;
  for (const dirent of fsx.readdir(dir)) {
    const full = path.join(dir, dirent.name);
    let candidate: number | undefined;
    if (dirent.isDirectory()) {
      if (SKIPPED_SOURCE_DIRS.has(dirent.name)) continue;
      candidate = newestSourceMtimeMs(full, fsx);
    } else if (dirent.isFile()) {
      candidate = fsx.stat(full).mtimeMs;
    }
    if (candidate !== undefined && (newest === undefined || candidate > newest)) {
      newest = candidate;
    }
  }
  return newest;
}

/**
 * Judge the workspace build at `root` (the directory holding `packages/cli`)
 * against its source: a package is stale iff its newest source file is
 * STRICTLY newer than its `dist/index.js`. A package whose `src` or dist entry
 * is absent is not judged (a checkout without `packages/core` judges cli only).
 * Throws on an unreadable path; the caller decides the posture.
 */
function readWorkspaceFreshness(root: string, fsx: FreshnessFs): WorkspaceFreshness {
  const cliEntry = path.join(root, PACKAGES_DIR, CLI_PACKAGE, DIST_DIR, ENTRY_FILE);
  const freshness: WorkspaceFreshness = {
    builtAt: new Date(fsx.stat(cliEntry).mtimeMs).toISOString(),
  };
  for (const pkg of JUDGED_PACKAGES) {
    const srcDir = path.join(root, PACKAGES_DIR, pkg, SRC_DIR);
    const distEntry = path.join(root, PACKAGES_DIR, pkg, DIST_DIR, ENTRY_FILE);
    if (!fs.existsSync(srcDir) || !fs.existsSync(distEntry)) continue;
    const distMs = fsx.stat(distEntry).mtimeMs;
    const sourceMs = newestSourceMtimeMs(srcDir, fsx);
    if (sourceMs !== undefined && sourceMs > distMs) {
      freshness.stale = {
        package: pkg,
        sourceNewestAt: new Date(sourceMs).toISOString(),
        distBuiltAt: new Date(distMs).toISOString(),
      };
      break;
    }
  }
  return freshness;
}

/** The shared tail of both stale lines — the package, both instants, the cure. */
function staleDetail(stale: NonNullable<WorkspaceFreshness['stale']>): string {
  return `${PACKAGES_DIR}/${stale.package}/${SRC_DIR} changed ${stale.sourceNewestAt}, after its dist was built ${stale.distBuiltAt} — run pnpm build.`;
}

/**
 * Resolve the project-local CLI entry by walking up from `cwd`, mirroring the
 * ADR-072 cascade's deterministic tiers:
 *
 * 1. **Workspace-HEAD** — `packages/cli/dist/index.js`, identity-guarded on
 *    `packages/cli/package.json` declaring `@mmnto/cli` (the dogfood monorepo;
 *    the build you just made wins over any installed copy).
 * 2. **Pinned dependency** — `node_modules/@mmnto/cli/dist/index.js`, the
 *    project's version-locked install via the package's own entry point.
 *
 * Both tiers require the BUILT entry to exist — an unbuilt checkout falls
 * through to running in place (where the mmnto-ai/totem#2018 L2 hint explains
 * the build step).
 *
 * The workspace tier also carries `freshness` (mmnto-ai/totem#2934). Its read
 * is best-effort with the same posture as the probe in `maybeReexecLocal`, but
 * it never disables the tier: when it throws, `freshness` is absent and the
 * entry still resolves (`debug` rethrows instead).
 */
export function resolveLocalEntry(cwd: string, opts?: ResolveOptions): LocalEntry | undefined {
  let dir = path.resolve(cwd);
  for (;;) {
    const workspacePkg = path.join(dir, PACKAGES_DIR, CLI_PACKAGE, PACKAGE_JSON);
    const workspaceEntry = path.join(dir, PACKAGES_DIR, CLI_PACKAGE, DIST_DIR, ENTRY_FILE);
    if (
      fs.existsSync(workspaceEntry) &&
      fs.existsSync(workspacePkg) &&
      NAME_IS_CLI_RE.test(fs.readFileSync(workspacePkg, 'utf-8'))
    ) {
      const local: LocalEntry = {
        entry: workspaceEntry,
        version: readVersion(workspacePkg),
        tier: 'workspace',
      };
      try {
        local.freshness = readWorkspaceFreshness(dir, opts?.freshnessFs ?? NODE_FRESHNESS_FS);
      } catch (err) {
        // The freshness read is a sensor, never a gate: an unreadable source
        // tree or dist entry drops the build instant and the stale line but
        // keeps the delegation (mmnto-ai/totem#2934, the mmnto-ai/totem#2153
        // posture). TOTEM_DEBUG=1 surfaces it.
        if (opts?.debug === true) throw err;
      }
      return local;
    }

    const pinnedDir = path.join(dir, NODE_MODULES_DIR, '@mmnto', CLI_PACKAGE);
    const pinnedEntry = path.join(pinnedDir, DIST_DIR, ENTRY_FILE);
    if (fs.existsSync(pinnedEntry)) {
      return {
        entry: pinnedEntry,
        version: readVersion(path.join(pinnedDir, PACKAGE_JSON)),
        tier: 'pinned',
      };
    }

    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Realpath when resolvable; the input when the path does not exist. */
function safeRealpath(p: string): string {
  return fs.existsSync(p) ? fs.realpathSync(p) : p;
}

export interface ReexecOptions {
  cwd?: string;
  /** Forwarded argv (everything after `node <entry>`). */
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  /** The running entry script — `process.argv[1]` in production. */
  selfPath?: string;
  /** This binary's own version, for the delegation notice. */
  selfVersion?: string;
  spawn?: typeof spawnSync;
  /** Overrides the workspace freshness probe's filesystem reads (tests). */
  freshnessFs?: FreshnessFs;
}

/**
 * Delegate to the project-local CLI when this binary is not it.
 *
 * Returns the child's exit code when delegation happened (the caller exits
 * with it), or `undefined` to run in place. A null child status maps to
 * failure (1), never silent success.
 */
export function maybeReexecLocal(opts?: ReexecOptions): number | undefined {
  const env = opts?.env ?? process.env;
  // This early return stays ABOVE the freshness probe (mmnto-ai/totem#2934):
  // TOTEM_NO_REEXEC=1 is honoured whole, so a run that sets it prints no stale
  // line. A delegated child always runs with it, so the parent's stale line is
  // the only one a delegation prints.
  if (env['TOTEM_NO_REEXEC'] === '1') return undefined;

  const cwd = opts?.cwd ?? process.cwd();
  let local: LocalEntry | undefined;
  let alreadyLocal = false;
  try {
    local = resolveLocalEntry(cwd, {
      freshnessFs: opts?.freshnessFs,
      debug: env['TOTEM_DEBUG'] === '1',
    });
    if (local !== undefined) {
      const selfPath = opts?.selfPath ?? process.argv[1] ?? '';
      alreadyLocal = safeRealpath(local.entry) === safeRealpath(selfPath);
    }
  } catch (err) {
    // The probe is best-effort: an unreadable path mid-walk (EACCES/EISDIR in
    // sandboxed or permission-restricted environments) falls through to
    // running in place — a probe failure must never crash the CLI with a raw
    // I/O stack (mmnto-ai/totem#2153 round-1). TOTEM_DEBUG=1 surfaces it.
    if (env['TOTEM_DEBUG'] === '1') throw err;
    return undefined;
  }
  if (local === undefined) return undefined;

  const freshness = local.tier === 'workspace' ? local.freshness : undefined;
  if (alreadyLocal) {
    // Running the workspace dist directly (`node packages/cli/dist/index.js`)
    // never delegates, so it prints no banner; a stale build still says so.
    if (freshness?.stale !== undefined) {
      process.stderr.write(
        `[totem] This workspace build is STALE: ${staleDetail(freshness.stale)}\n`,
      );
    }
    return undefined;
  }

  const localLabel = local.version !== undefined ? `@mmnto/cli@${local.version}` : '@mmnto/cli';
  const builtLabel = freshness !== undefined ? ` (built ${freshness.builtAt})` : '';
  const selfLabel = opts?.selfVersion !== undefined ? ` (this binary: ${opts.selfVersion})` : '';
  process.stderr.write(
    `[totem] Delegating to the project-local ${localLabel}${builtLabel} at ${local.entry}${selfLabel} — set TOTEM_NO_REEXEC=1 to disable.\n`,
  );
  // A sensor, never a gate: a stale build is named, and delegated to anyway.
  if (freshness?.stale !== undefined) {
    process.stderr.write(
      `[totem] The project-local build is STALE: ${staleDetail(freshness.stale)} Delegating anyway.\n`,
    );
  }

  const spawn = opts?.spawn ?? spawnSync;
  const argv = opts?.argv ?? process.argv.slice(2);
  // totem-context: direct cross-spawn justified (same primitive safeExec
  // wraps) — delegation needs stdio inherit + non-throwing exit-code
  // propagation, which safeExec (pipe-buffered, throws on non-zero) cannot
  // provide. Target is process.execPath + the identity-guarded local entry;
  // argv as array, no shell. Allowlisted in pack-agent-security repo-sweep.
  const child = spawn(process.execPath, [local.entry, ...argv], {
    stdio: 'inherit',
    env: { ...env, TOTEM_NO_REEXEC: '1' },
  });
  // A spawn-level failure AFTER announcing delegation is reported, never
  // swallowed — the user saw the delegation start; they must see why it died.
  // Loose != null: cross-spawn fills `error: null` on SUCCESS (verified live
  // on the 1.59.0 first run — a strict !== undefined check crashed every
  // successful delegation's exit path).
  if (child.error != null) {
    process.stderr.write(`[totem] Delegation failed to start: ${child.error.message}\n`);
  }
  return child.status ?? 1;
}
