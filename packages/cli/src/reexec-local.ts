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
 * How current a workspace build looks against its source (mmnto-ai/totem#2934).
 * A sensor only: it shapes stderr on the delegation path, never the delegation.
 */
export interface WorkspaceFreshness {
  /** ISO instant of the cli dist entry's mtime — what the banner prints. */
  builtAt: string;
  /** Present iff a source file's mtime is newer than its package's dist entry. */
  stale?: { package: WorkspacePackage; sourceNewestAt: string; distBuiltAt: string };
}

export interface LocalEntry {
  /** Absolute path to the local `dist/index.js` to delegate to. */
  entry: string;
  /** The local install's version, when its package.json is readable. */
  version?: string;
  /** Which cascade tier matched: workspace-HEAD or the pinned dependency. */
  tier: 'workspace' | 'pinned';
}

/**
 * Every filesystem read the freshness probe makes (existence, mtime, directory
 * listing) — a seam for tests. The cascade walk in `resolveLocalEntry` does
 * not use it.
 */
export interface FreshnessFs {
  exists(p: string): boolean;
  stat(p: string): { mtimeMs: number };
  readdir(p: string): fs.Dirent[];
}

const NODE_FRESHNESS_FS: FreshnessFs = {
  exists: (p) => fs.existsSync(p),
  stat: (p) => fs.statSync(p),
  readdir: (p) => fs.readdirSync(p, { withFileTypes: true }),
};

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
 * against its source: a package reads as stale iff the newest mtime of a file
 * under its `src` is STRICTLY newer than its `dist/index.js`. A package whose
 * `src` or dist entry is absent is not judged (a checkout without
 * `packages/core` judges cli only). Throws on an unreadable path; the caller
 * decides the posture.
 *
 * Limits — it compares modification times, nothing else: it does not see a
 * deleted source file or a rename that keeps its mtime, it skips symlinked
 * sources, and it reads a touched or reverted file (same content, newer
 * mtime) as newer. A cached turbo build does not re-stamp `dist` either. That
 * is why the line it feeds says "may be stale" and "if the source changed".
 * Two more: EVERY file under `src` counts, tests and fixtures that are never
 * compiled into `dist` included, so editing a test trips the line although the
 * build is current; and a source file stamped in the future keeps the line
 * printing after a forced build until the clock passes that stamp.
 */
function readWorkspaceFreshness(root: string, fsx: FreshnessFs): WorkspaceFreshness {
  const cliEntry = path.join(root, PACKAGES_DIR, CLI_PACKAGE, DIST_DIR, ENTRY_FILE);
  const freshness: WorkspaceFreshness = {
    builtAt: new Date(fsx.stat(cliEntry).mtimeMs).toISOString(),
  };
  for (const pkg of JUDGED_PACKAGES) {
    const srcDir = path.join(root, PACKAGES_DIR, pkg, SRC_DIR);
    const distEntry = path.join(root, PACKAGES_DIR, pkg, DIST_DIR, ENTRY_FILE);
    if (!fsx.exists(srcDir) || !fsx.exists(distEntry)) continue;
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

/** The workspace root (the directory holding `packages/cli`) of a workspace entry. */
function workspaceRootOf(entry: string): string {
  // entry = <root>/packages/cli/dist/index.js
  return path.dirname(path.dirname(path.dirname(path.dirname(entry))));
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
 */
export function resolveLocalEntry(cwd: string): LocalEntry | undefined {
  let dir = path.resolve(cwd);
  for (;;) {
    const workspacePkg = path.join(dir, PACKAGES_DIR, CLI_PACKAGE, PACKAGE_JSON);
    const workspaceEntry = path.join(dir, PACKAGES_DIR, CLI_PACKAGE, DIST_DIR, ENTRY_FILE);
    if (
      fs.existsSync(workspaceEntry) &&
      fs.existsSync(workspacePkg) &&
      NAME_IS_CLI_RE.test(fs.readFileSync(workspacePkg, 'utf-8'))
    ) {
      return { entry: workspaceEntry, version: readVersion(workspacePkg), tier: 'workspace' };
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
    local = resolveLocalEntry(cwd);
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
  if (local === undefined || alreadyLocal) return undefined;

  // Delegation is now certain. Only here, and only on the workspace tier, is
  // the freshness read paid (mmnto-ai/totem#2934): a direct run of the
  // workspace dist prints nothing and walks nothing, and the pinned tier never
  // reads an mtime (npm tarballs ship fixed mtimes).
  let freshness: WorkspaceFreshness | undefined;
  if (local.tier === 'workspace') {
    // totem-context: intentional best-effort sensor read — the catch below
    // does not rethrow by design (ruled in the mmnto-ai/totem#2934 fold): a
    // stale-build hint must never crash or block the delegation it decorates.
    try {
      freshness = readWorkspaceFreshness(
        workspaceRootOf(local.entry),
        opts?.freshnessFs ?? NODE_FRESHNESS_FS,
      );
      // totem-context: intentional degradation — see directive above the try; placed on the line before the catch keyword, where the rule reads it.
    } catch (err) {
      // A sensor, never a gate, and never a crash — not even under
      // TOTEM_DEBUG=1: a file vanishing between readdir and stat is ordinary
      // while an editor or agent writes. Without debug the sensor is dropped
      // silently; with it, one line names the failure. Delegation proceeds.
      if (env['TOTEM_DEBUG'] === '1') {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[totem] freshness probe failed: ${message}\n`);
      }
    }
  }

  const localLabel = local.version !== undefined ? `@mmnto/cli@${local.version}` : '@mmnto/cli';
  const builtLabel = freshness !== undefined ? ` (built ${freshness.builtAt})` : '';
  const selfLabel = opts?.selfVersion !== undefined ? ` (this binary: ${opts.selfVersion})` : '';
  process.stderr.write(
    `[totem] Delegating to the project-local ${localLabel}${builtLabel} at ${local.entry}${selfLabel} — set TOTEM_NO_REEXEC=1 to disable.\n`,
  );
  // Says what was measured (an mtime), names a cure that works on a cached
  // turbo build, and delegates anyway.
  const stale = freshness?.stale;
  if (stale !== undefined) {
    process.stderr.write(
      `[totem] The project-local build may be stale: a file under ${PACKAGES_DIR}/${stale.package}/${SRC_DIR} was modified ${stale.sourceNewestAt}, after its dist was built ${stale.distBuiltAt}. If the source changed, run pnpm build --force (a cached turbo build does not re-stamp dist). Delegating anyway.\n`,
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
