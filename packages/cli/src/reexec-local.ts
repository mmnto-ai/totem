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

export interface LocalEntry {
  /** Absolute path to the local `dist/index.js` to delegate to. */
  entry: string;
  /** The local install's version, when its package.json is readable. */
  version?: string;
  /** Which cascade tier matched: workspace-HEAD or the pinned dependency. */
  tier: 'workspace' | 'pinned';
}

/** Probe-grade version read — no JSON.parse, no fail-open catch. */
function readVersion(pkgJsonPath: string): string | undefined {
  if (!fs.existsSync(pkgJsonPath)) return undefined;
  return VERSION_RE.exec(fs.readFileSync(pkgJsonPath, 'utf-8'))?.[1];
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
    const workspacePkg = path.join(dir, 'packages', 'cli', 'package.json');
    const workspaceEntry = path.join(dir, 'packages', 'cli', 'dist', 'index.js');
    if (
      fs.existsSync(workspaceEntry) &&
      fs.existsSync(workspacePkg) &&
      NAME_IS_CLI_RE.test(fs.readFileSync(workspacePkg, 'utf-8'))
    ) {
      return { entry: workspaceEntry, version: readVersion(workspacePkg), tier: 'workspace' };
    }

    const pinnedDir = path.join(dir, 'node_modules', '@mmnto', 'cli');
    const pinnedEntry = path.join(pinnedDir, 'dist', 'index.js');
    if (fs.existsSync(pinnedEntry)) {
      return {
        entry: pinnedEntry,
        version: readVersion(path.join(pinnedDir, 'package.json')),
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

  const localLabel = local.version !== undefined ? `@mmnto/cli@${local.version}` : '@mmnto/cli';
  const selfLabel = opts?.selfVersion !== undefined ? ` (this binary: ${opts.selfVersion})` : '';
  process.stderr.write(
    `[totem] Delegating to the project-local ${localLabel} at ${local.entry}${selfLabel} — set TOTEM_NO_REEXEC=1 to disable.\n`,
  );

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
  if (child.error !== undefined) {
    process.stderr.write(`[totem] Delegation failed to start: ${child.error.message}\n`);
  }
  return child.status ?? 1;
}
