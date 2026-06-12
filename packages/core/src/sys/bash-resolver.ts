/**
 * Git-Bash resolver (mmnto-ai/totem#2159) — the cohort-standard fix for the
 * bare-`bash`-is-WSL trap.
 *
 * On Windows hosts, Git-for-Windows puts only `Git\cmd` on PATH, so a bare
 * `bash` spawn outside an MSYS/git-hook context resolves to
 * `C:\Windows\System32\bash.exe` — WSL's Linux bash, which cannot read
 * `D:\...` Windows paths and fails every script it is handed. The
 * operator-ruled cohort standard (2026-06-12; strategy concur 0240Z) is
 * repo-side mechanization with ONE exported resolver: **bare `bash` is never
 * spawned by repo tooling on win32** — every bash-invoking surface consumes
 * this function instead.
 *
 * Resolution: memo → POSIX fast-path (`'bash'` is genuine there) →
 * `git --exec-path` derivation (walk up to Git's install root, probe
 * `usr/bin/bash.exe` — the real MSYS bash — then `bin/bash.exe`, the
 * wrapper) → conventional install-path probes → HARD `TotemError` naming
 * every probed path. A bare-`'bash'` final fallback is deliberately absent:
 * it would silently re-enter the WSL trap this module exists to kill
 * (Tenet 4 — the failure must be loud and actionable, not a cryptic
 * `No such file or directory` from a Linux bash reading a Windows path).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { TotemError } from '../errors.js';
import { safeExec } from './exec.js';

/**
 * Process-lifetime memo of an effectively immutable host fact (Git's install
 * root does not move mid-process). `git --exec-path` shells out, and
 * bash-spawning test helpers call the resolver per spawn — without the memo
 * a test file would pay the subprocess cost on every assertion. `root` is
 * null on POSIX (no Git-for-Windows tree to remember).
 */
let cached: { bash: string; root: string | null } | null = null;

/** Conventional Git-for-Windows install roots probed when `git` itself is unavailable. */
const CONVENTIONAL_GIT_ROOTS: readonly string[] = ['C:\\Program Files\\Git'];

/** The two bash locations inside a Git-for-Windows root, preferred first. */
function bashCandidatesUnder(gitRoot: string): string[] {
  return [path.join(gitRoot, 'usr', 'bin', 'bash.exe'), path.join(gitRoot, 'bin', 'bash.exe')];
}

/**
 * Resolve the bash executable repo tooling must spawn. Returns `'bash'` on
 * POSIX (no subprocess spent); on win32 returns an absolute Git-Bash path or
 * throws `BASH_RESOLUTION_FAILED` — never the literal `'bash'`.
 */
export function resolveBash(): string {
  if (cached !== null) {
    return cached.bash;
  }
  if (os.platform() !== 'win32') {
    cached = { bash: 'bash', root: null };
    return cached.bash;
  }

  const probed: string[] = [];

  // Primary: derive Git's install root from git itself. `--exec-path`
  // returns `<root>/mingw64/libexec/git-core` (mingw32 on 32-bit builds);
  // three levels up is the root regardless of variant. `path.resolve`
  // normalizes the mixed forward/backslash output Git emits on Windows.
  // totem-context: intentional cleanup — a missing/failing `git` here is the routine fall-to-conventional-probes signal, and the probe chain ends in a HARD TotemError below; nothing degrades silently.
  try {
    const execPath = safeExec('git', ['--exec-path']);
    const gitRoot = path.resolve(execPath, '..', '..', '..');
    for (const candidate of bashCandidatesUnder(gitRoot)) {
      probed.push(candidate);
      if (fs.existsSync(candidate)) {
        cached = { bash: candidate, root: gitRoot };
        return cached.bash;
      }
    }
    // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
  } catch {
    // Fall through to the conventional probes.
  }

  for (const root of CONVENTIONAL_GIT_ROOTS) {
    for (const candidate of bashCandidatesUnder(root)) {
      probed.push(candidate);
      if (fs.existsSync(candidate)) {
        cached = { bash: candidate, root };
        return cached.bash;
      }
    }
  }

  throw new TotemError(
    'BASH_RESOLUTION_FAILED',
    `no Git-Bash found on win32 (probed: ${probed.join(', ')})`,
    'install Git for Windows (its usr\\bin\\bash.exe is the required bash) — bare `bash` resolves to WSL on this host and cannot read Windows paths (mmnto-ai/totem#2159).',
  );
}

/**
 * Child-process env for spawning the resolved bash: on win32, Git's
 * `usr\bin` and `bin` are PREPENDED to PATH so the script's own children
 * (`grep`, `tr`, `sha256sum`, `cut` — the MSYS coreutils) resolve. This is
 * the trap's second layer: a directly-spawned Git-Bash inherits the parent
 * PATH (which lacks `usr\bin` — that's the whole #2159 class), so the bash
 * binary runs but every coreutil inside the script is `command not found`.
 * Git-hook contexts never see this because git prepends its own tree before
 * running hooks; this function reproduces that contract for plain spawns.
 *
 * POSIX returns `base` unchanged. The existing PATH key's casing is
 * preserved (Windows env keys are case-insensitive; introducing a second
 * `PATH` spelling alongside an inherited `Path` is undefined behavior).
 */
export function bashSpawnEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  resolveBash();
  if (cached === null || cached.root === null) {
    return base;
  }
  const segments = [path.join(cached.root, 'usr', 'bin'), path.join(cached.root, 'bin')];
  const pathKey = Object.keys(base).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const current = base[pathKey];
  if (current !== undefined && current.length > 0) {
    segments.push(current);
  }
  return { ...base, [pathKey]: segments.join(path.delimiter) };
}

/**
 * Reset the module memo so unit tests can exercise every resolution branch
 * without cross-test bleed. Test-only by convention (underscore prefix);
 * production callers have no reason to clear an immutable host fact.
 */
export function _clearBashResolverCacheForTesting(): void {
  cached = null;
}
