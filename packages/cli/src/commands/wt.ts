/**
 * `totem wt create|remove|list` — worktree lifecycle verbs with VERIFIED
 * removal (mmnto-ai/totem#2580 slice-2).
 *
 * The reason this exists is one git behaviour: `git worktree remove` exits 0
 * on a removal that leaves the directory standing, and a husk that nobody
 * notices is the failure class the slice-1 estate sensor keeps finding. So the
 * removal verb never trusts an exit code — it removes, verifies absence,
 * finishes the residue if anything is left, re-verifies, and only then touches
 * the registry. Exit 0 means the directory is gone, and nothing else does.
 *
 * Three disciplines run through every verb here:
 *   - **Record-first.** `create` writes the `~/.totem/worktrees.json` entry
 *     BEFORE invoking git. A phantom entry fails visibly (`wt list` prints it
 *     `missing`); an unrecorded worktree fails invisibly, which is exactly the
 *     class this issue exists for.
 *   - **Check-first.** A path is passed to `git worktree remove` only when
 *     git's own list names it (the `author-sandbox.ts:112` precedent). A path
 *     git does not track never reaches a git removal verb, and a path that is
 *     in NEITHER git's list nor the registry is never touched at all.
 *   - **Accounting, not classification.** `wt list` reports what was recorded
 *     plus whether it is on disk. Deciding whether a worktree is active or
 *     stale stays with `totem doctor --estate` — derive-once, one sensor.
 *
 * Classification of what a seat may delete is deliberately narrow at the ECL
 * boundary: untracked content under `<wt>/.totem/orchestration/**` blocks
 * removal outright, with no bypass flag (the operator ruling — a bypass would
 * re-open the silently-deleted-ECL hole this verb closes).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ResidueRemovalResult, WorktreeEntry } from '@mmnto/totem';

import { bold, log, success as successColor, warn as warnColor } from '../ui.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Worktree';

/** Env var that names the container root when `--root` is absent (the ruling). */
const ROOT_ENV_VAR = 'TOTEM_WORKTREE_ROOT';

/** Read probes carry a timeout; the mutation verbs do not (author-sandbox.ts:57). */
const GIT_READ_TIMEOUT_MS = 15_000;

const MS_PER_DAY = 86_400_000;

/**
 * A slug is one path segment AND part of a branch name, so it stays in the
 * intersection of what both accept: no separators, no `..`, no leading dash.
 */
const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_SLUG_LENGTH = 64;

/** A ticket lands inside the default branch name — same conservative alphabet. */
const TICKET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * A light branch-name guard. `safeExec` already makes injection impossible
 * (structured argv, never a shell string); this exists so a malformed ref
 * fails with our message instead of a raw `git check-ref-format` complaint.
 */
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** The ECL path whose untracked content blocks a removal (ecl-discipline §4.6). */
const ECL_PATHSPEC = '.totem/orchestration';

// ─── Types ──────────────────────────────────────────────

/**
 * The core barrel, imported dynamically inside each command (mmnto-ai/totem#2339).
 * The `--help` cold-start protection is index.ts's lazy per-action
 * `await import('./commands/wt.js')`; the dynamic imports HERE (core, and
 * `./mail.js` for seat resolution) keep this module itself light so that lazy
 * load stays cheap. Only types cross the boundary statically — erased at build.
 */
type Core = typeof import('@mmnto/totem');

/** The injected exec seam — structurally `safeExec`, so tests pass a spy. */
export type WtExecFn = Core['safeExec'];

/** Injected residue finish, so the still-present failure arm is reachable in tests. */
export type WtResidueFn = (dir: string) => Promise<ResidueRemovalResult>;

export interface WtCreateOptions {
  slug: string;
  /** Container root override — highest precedence. */
  root?: string;
  /** Seat override; default is `resolveSelfSender` against the home repo. */
  seat?: string;
  /** Branch override; default `feat/<ticket>-<slug>` or `wt/<slug>`. */
  branch?: string;
  ticket?: string;
  json?: boolean;
  /** Test seam — production callers use `process.cwd()`. */
  cwdForTest?: string;
  /** Test seam — production callers use `process.env`. */
  envForTest?: NodeJS.ProcessEnv;
  /** Test seam — canned git. */
  execForTest?: WtExecFn;
  /** Test seam — pins `createdAt`. */
  nowForTest?: string;
}

export interface WtRemoveOptions {
  /** Absolute path, relative path, or a unique recorded basename. */
  target: string;
  json?: boolean;
  cwdForTest?: string;
  execForTest?: WtExecFn;
  /** Test seam — production callers use `removeWorktreeResidue`. */
  residueForTest?: WtResidueFn;
}

export interface WtListOptions {
  json?: boolean;
  /** Test seam — pins every `age-days`. */
  nowForTest?: number;
}

// ─── Local helpers ──────────────────────────────────────

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function writeJson(payload: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

function ageDays(iso: string, now: number): number | undefined {
  const created = Date.parse(iso);
  if (!Number.isFinite(created)) return undefined;
  return Math.max(0, Math.floor((now - created) / MS_PER_DAY));
}

// ─── Core-bound helpers ─────────────────────────────────

/**
 * Every helper that touches a core VALUE lives behind this factory and closes
 * over the one dynamically-imported barrel instance (see the `Core` note: a
 * static value import would defeat the lazy-loading contract). Bodies are
 * otherwise ordinary module helpers — the factory exists only to carry `core`.
 */
function coreHelpers(core: Core) {
  const {
    deleteWorktreeEntry,
    parseWorktreeListPorcelain,
    sanitizeForTerminal,
    TotemConfigError,
    TotemError,
    TotemGitError,
    worktreePathExists,
    worktreePathKey,
  } = core;

  /**
   * True when `child` lies strictly UNDER `base` (case-folded on win32). The
   * trailing separator keeps sibling names apart — `totemville` is not under
   * `totem` (#2580 slice-2 falsification, finding 3's containment shape).
   */
  function pathIsUnder(child: string, base: string): boolean {
    const baseKey = worktreePathKey(base);
    return worktreePathKey(child).startsWith(
      baseKey.endsWith(path.sep) ? baseKey : baseKey + path.sep,
    );
  }

  /**
   * Paths, branch names, and git stderr all originate outside this process:
   * sanitize + flatten before any terminal write so embedded ANSI or newlines
   * cannot forge extra log lines (the doctor-estate.ts:186 render helper).
   */
  function render(text: string): string {
    return sanitizeForTerminal(text)
      .replace(/[\t\n]+/g, ' ')
      .replace(/ {2,}/g, ' ')
      .trim();
  }

  /**
   * Resolve the home repo, or fail loud — no verb here guesses at one. Asked
   * through the injected exec seam rather than core's `resolveGitRoot` so a
   * test can drive the whole verb without a real git tree, exactly as
   * `scanEstate` takes its git through an injected seam.
   */
  function requireGitRoot(exec: WtExecFn, cwd: string): string {
    // totem-context: intentional cleanup — a failed toplevel probe is re-thrown immediately as a named TotemGitError; the catch exists to attach the recovery hint, and nothing is swallowed.
    try {
      const out = exec('git', ['--no-optional-locks', '-C', cwd, 'rev-parse', '--show-toplevel'], {
        timeout: GIT_READ_TIMEOUT_MS,
      });
      return path.resolve(out.trim());
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch (err) {
      throw new TotemGitError(
        `wt: ${render(cwd)} is not inside a readable git repository: ${render(describe(err))}`,
        'Run the command from inside the home repository the worktree belongs to.',
        err,
      );
    }
  }

  /**
   * `wt create` runs from the PRIMARY checkout only (cohort-overlay §2 — the
   * same convention that keeps mail on the primary): inside a linked worktree,
   * `rev-parse --show-toplevel` answers with the WORKTREE, so the entry would
   * record a home repo that vanishes with it and every later removal of its
   * children would resolve against nothing (#2580 slice-2 falsification,
   * finding 10). The discriminator: `--git-dir` and `--git-common-dir` name
   * the SAME directory for every primary shape — an in-tree `.git` and a
   * `--separate-git-dir` layout alike — and diverge only in a linked worktree,
   * whose git dir is `<common>/worktrees/<name>`. Comparing the common dir
   * against `<toplevel>/.git` instead would misread separate-git-dir primaries
   * as worktrees (re-verification round 2, finding 1).
   */
  function assertPrimaryCheckout(exec: WtExecFn, cwd: string): void {
    let gitDir: string;
    let commonDir: string;
    // totem-context: intentional cleanup — a probe that cannot answer is re-thrown as a named TotemGitError; the catch attaches the recovery hint, nothing is swallowed.
    try {
      const out = exec(
        'git',
        ['--no-optional-locks', '-C', cwd, 'rev-parse', '--git-dir', '--git-common-dir'],
        { timeout: GIT_READ_TIMEOUT_MS },
      );
      // One answer per line, and git may answer with a path RELATIVE to the
      // cwd (a bare `.git` at the toplevel) — resolve both before comparing.
      const lines = out
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      if (lines.length < 2) {
        throw new Error(`expected two rev-parse answers, got ${lines.length}`);
      }
      gitDir = path.resolve(cwd, lines[0]!);
      commonDir = path.resolve(cwd, lines[1]!);
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch (err) {
      throw new TotemGitError(
        `wt create: cannot determine whether ${render(cwd)} is the primary checkout: ${render(describe(err))}`,
        'Run `totem wt create` from the primary checkout of the home repository.',
        err,
      );
    }
    if (worktreePathKey(gitDir) !== worktreePathKey(commonDir)) {
      throw new TotemConfigError(
        `wt create: ${render(cwd)} is inside a linked worktree, not the primary checkout`,
        'Run `totem wt create` from the primary checkout (cohort-overlay §2 — worktrees are minted from the primary, the same convention that keeps mail there).',
        'CONFIG_INVALID',
      );
    }
  }

  /** Every recorded worktree path git names for this repo, folded for comparison. */
  function gitListedPaths(exec: WtExecFn, repoRoot: string): Set<string> {
    const raw = exec(
      'git',
      ['--no-optional-locks', '-C', repoRoot, 'worktree', 'list', '--porcelain'],
      { timeout: GIT_READ_TIMEOUT_MS },
    );
    return new Set(parseWorktreeListPorcelain(raw).map((entry) => worktreePathKey(entry.path)));
  }

  /**
   * Best-effort rollback of the record-first entry after a failed
   * `git worktree add`. Returns the failure text when the rollback ITSELF
   * failed — the caller names the phantom entry loudly rather than letting the
   * operator discover it later from `wt list`. Guarded by the entry's own
   * `createdAt` so a concurrent create that re-recorded the path is never the
   * one rolled back (bot round, Greptile P1).
   */
  async function rollbackCreateEntry(
    target: string,
    expectCreatedAt: string,
  ): Promise<string | undefined> {
    // totem-context: intentional cleanup — a failed ROLLBACK must not replace the git failure that caused it; the outcome is RETURNED to the caller, which reports the phantom entry loudly and folds it into the thrown error (nothing is swallowed).
    try {
      await deleteWorktreeEntry(target, { expectCreatedAt });
      return undefined;
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch (err) {
      return describe(err);
    }
  }

  /**
   * Resolve the command argument. A path-shaped argument resolves against the
   * cwd; a bare name is matched against recorded BASENAMES, and an ambiguous
   * name is a hard error listing the candidates rather than a coin flip.
   */
  function resolveRemoveTarget(
    arg: string,
    cwd: string,
    registryPaths: string[],
  ): { resolvedPath: string } {
    const looksLikePath =
      path.isAbsolute(arg) || arg.includes('/') || arg.includes('\\') || arg.startsWith('.');
    if (looksLikePath) return { resolvedPath: path.resolve(cwd, arg) };

    const wanted = worktreePathKey(arg);
    const matches = registryPaths.filter(
      (recorded) => worktreePathKey(path.basename(recorded)) === wanted,
    );
    if (matches.length > 1) {
      throw new TotemConfigError(
        `wt remove: "${render(arg)}" matches ${matches.length} recorded worktrees`,
        `Pass the full path instead. Candidates: ${matches.map((m) => render(m)).join(', ')}`,
        'CONFIG_INVALID',
      );
    }
    if (matches.length === 1) return { resolvedPath: path.resolve(matches[0]!) };
    // No recorded basename — fall through to the cwd-relative reading so the
    // "in neither git's list nor the registry" hard error is what reports it.
    return { resolvedPath: path.resolve(cwd, arg) };
  }

  /**
   * Untracked (including ignored) content under `<wt>/.totem/orchestration/**`
   * blocks removal. `--ignored` is deliberate: an ignored ECL file is still
   * ECL, and the whole point of the refusal is that consolidation is cheap
   * while a silently deleted dispatch is not recoverable. No bypass flag
   * exists (ruling). `-uall` is load-bearing twice over (#2580 slice-2
   * falsification, finding 2): it names the exact FILES rather than one
   * collapsed `?? .totem/orchestration/` row, and it overrides a
   * `status.showUntrackedFiles=no` in the shared repo config — which would
   * otherwise silence the probe entirely and turn the no-bypass ruling into a
   * config-reachable bypass with unrecoverable loss.
   *
   * When the probe itself cannot run (a husk whose `.git` pointer is dangling
   * is not a git worktree at all), the fallback is conservative: refuse if the
   * orchestration directory exists on disk, proceed with a disclosed note if
   * it does not. Never treat an unanswerable probe as a clean answer.
   */
  function assertEclClear(exec: WtExecFn, worktreePath: string, notes: string[]): void {
    let output: string;
    // totem-context: intentional cleanup — a status probe that cannot RUN (unlisted husk, dangling gitdir) is not a clean ECL answer; the catch falls through to the on-disk fallback below, which refuses whenever orchestration content is present.
    try {
      output = exec(
        'git',
        [
          '--no-optional-locks',
          '-C',
          worktreePath,
          'status',
          '--porcelain',
          '--ignored',
          '-uall',
          '--',
          ECL_PATHSPEC,
        ],
        { timeout: GIT_READ_TIMEOUT_MS },
      );
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch (err) {
      const eclDir = path.join(worktreePath, ECL_PATHSPEC.split('/').join(path.sep));
      if (worktreePathExists(eclDir)) {
        throw new TotemError(
          'CHECK_FAILED',
          `wt remove: refusing — the ECL probe could not run in ${render(worktreePath)} (${render(describe(err))}) and ${render(eclDir)} exists`,
          'Consolidate or copy the orchestration content out, delete the directory, then re-run (ecl-discipline §4.6).',
          err,
        );
      }
      notes.push(
        `ECL probe could not run (${render(describe(err))}); no ${ECL_PATHSPEC} directory on disk, so nothing was at risk`,
      );
      return;
    }

    const rows = output
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
    if (rows.length === 0) return;

    throw new TotemError(
      'CHECK_FAILED',
      `wt remove: refusing — ${rows.length} uncommitted file(s) under ${render(worktreePath)}${path.sep}${ECL_PATHSPEC}: ${rows.map((r) => render(r)).join(' · ')}`,
      'Consolidate the ECL (commit or move the dispatches out), then re-run. There is no bypass flag: a silently deleted dispatch is not recoverable (ecl-discipline §4.6).',
    );
  }

  return {
    render,
    pathIsUnder,
    requireGitRoot,
    assertPrimaryCheckout,
    gitListedPaths,
    rollbackCreateEntry,
    resolveRemoveTarget,
    assertEclClear,
  };
}

// ─── create ─────────────────────────────────────────────

/**
 * Create a worktree at `<root>/<repo>-<seat>-<slug>` on a NEW branch.
 *
 * `git worktree add -b` always: an existing branch is a hard error in v1 (the
 * ruling), so a create can never silently adopt someone else's in-flight work.
 * The registry entry is written first and rolled back best-effort on a git
 * failure; a rollback that ALSO fails names the phantom entry loudly rather
 * than leaving the operator to discover it from `wt list`.
 */
export async function wtCreateCommand(options: WtCreateOptions): Promise<void> {
  const core = await import('@mmnto/totem');
  const {
    addWorktreeEntry,
    defaultWorktreeRoot,
    isPathSafeAgentId,
    TotemConfigError,
    TotemGitError,
    worktreePathExists,
    worktreePathKey,
    worktreeRegistryPath,
  } = core;
  const { render, pathIsUnder, requireGitRoot, assertPrimaryCheckout, rollbackCreateEntry } =
    coreHelpers(core);

  const cwd = options.cwdForTest ?? process.cwd();
  const env = options.envForTest ?? process.env;
  const exec = options.execForTest ?? core.safeExec;
  const createdAt = options.nowForTest ?? new Date().toISOString();

  const slug = options.slug.trim();
  if (!SLUG_PATTERN.test(slug) || slug.length > MAX_SLUG_LENGTH) {
    throw new TotemConfigError(
      `wt create: invalid slug ${JSON.stringify(options.slug)}`,
      `A slug is one path segment: letters, digits, dot, dash, underscore; at most ${MAX_SLUG_LENGTH} characters.`,
      'CONFIG_INVALID',
    );
  }
  if (options.ticket !== undefined && !TICKET_PATTERN.test(options.ticket)) {
    throw new TotemConfigError(
      `wt create: invalid --ticket ${JSON.stringify(options.ticket)}`,
      'Pass a plain issue reference such as 2580.',
      'CONFIG_INVALID',
    );
  }

  const repoRoot = requireGitRoot(exec, cwd);
  assertPrimaryCheckout(exec, cwd);
  const repoName = path.basename(repoRoot);

  let seat: string;
  if (options.seat !== undefined) {
    seat = options.seat.trim();
  } else {
    const { resolveSelfSender } = await import('./mail.js');
    // totem-context: intentional cleanup — the resolver's failure is re-thrown as a wt-scoped error whose message carries this verb's `--seat` guidance (the mail verb's `--from` lives in the resolver's recovery-hint field, which this wrapper never surfaces), and nothing is swallowed.
    try {
      seat = resolveSelfSender(repoRoot, env);
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch (err) {
      throw new TotemConfigError(
        `wt create: cannot derive the creating seat: ${render(describe(err))} — pass --seat <agent-id> or set TOTEM_SELF_AGENT`,
        'Pass --seat <agent-id> (e.g. totem-claude) or set TOTEM_SELF_AGENT.',
        'CONFIG_INVALID',
      );
    }
  }
  if (!isPathSafeAgentId(seat)) {
    throw new TotemConfigError(
      `wt create: invalid seat ${JSON.stringify(seat)}`,
      'Pass a plain agent-id such as "totem-claude" via --seat.',
      'CONFIG_INVALID',
    );
  }

  const branch = options.branch?.trim() ?? defaultBranchName(slug, options.ticket);
  // Trailing-dot and `.lock` components are `git check-ref-format` refusals
  // that would otherwise surface AFTER the record-first write, via the
  // rollback path — checked per PATH COMPONENT, since git refuses them
  // mid-ref too (re-verification round 2, finding 9).
  if (
    !BRANCH_PATTERN.test(branch) ||
    branch.includes('..') ||
    branch.endsWith('/') ||
    branch.split('/').some((part) => part.endsWith('.') || part.endsWith('.lock'))
  ) {
    throw new TotemConfigError(
      `wt create: invalid branch name ${JSON.stringify(branch)}`,
      'Use a plain ref name such as feat/2580-wt-verbs.',
      'CONFIG_INVALID',
    );
  }

  // Precedence (the ruling's Q1): --root > TOTEM_WORKTREE_ROOT > ~/.totem/worktrees.
  const envRoot = env[ROOT_ENV_VAR];
  const rootSource =
    options.root !== undefined
      ? '--root'
      : envRoot !== undefined && envRoot.trim().length > 0
        ? ROOT_ENV_VAR
        : 'default';
  const rawRoot =
    options.root ??
    (envRoot !== undefined && envRoot.trim().length > 0 ? envRoot.trim() : defaultWorktreeRoot());
  // A shell-quoted `--root '~/x'` or an env-carried `~` reaches this process
  // unexpanded, and `path.resolve` would mint a literal `~` directory that
  // then accretes into the recorded roots FOREVER (roots survive entry
  // removal) — expand it against the home dir first (bot round, CR finding 6).
  const expandedRoot =
    rawRoot === '~' || rawRoot.startsWith('~/') || rawRoot.startsWith(`~${path.sep}`)
      ? path.join(os.homedir(), rawRoot.slice(1))
      : rawRoot;
  const root = path.resolve(cwd, expandedRoot);

  // The location class the estate audit indicts (cohort-overlay §2): a
  // worktree beside its own repo, or inside it. Checked against the RESOLVED
  // root with CONTAINMENT, not just equality — `<repo>/.claude/worktrees` is
  // still inside the repo (#2580 slice-2 falsification, finding 3) — so no
  // flag/env combination reaches any of the three.
  const workspaceRoot = path.dirname(repoRoot);
  if (worktreePathKey(root) === worktreePathKey(repoRoot) || pathIsUnder(root, repoRoot)) {
    throw new TotemConfigError(
      `wt create: refusing to create a worktree inside the repo itself (${render(root)})`,
      `Use the default root (~/.totem/worktrees) or set ${ROOT_ENV_VAR} to a dedicated container directory (cohort-overlay §2).`,
      'CONFIG_INVALID',
    );
  }
  if (worktreePathKey(root) === worktreePathKey(workspaceRoot)) {
    throw new TotemConfigError(
      `wt create: refusing to create a worktree in the workspace root (${render(root)})`,
      `The workspace root is scanned for sibling repos and cohort mail; use the default root (~/.totem/worktrees) or set ${ROOT_ENV_VAR} (cohort-overlay §2).`,
      'CONFIG_INVALID',
    );
  }

  const target = path.join(root, `${repoName}-${seat}-${slug}`);
  if (worktreePathExists(target)) {
    throw new TotemConfigError(
      `wt create: ${render(target)} already exists`,
      'Choose a different slug, or remove the existing worktree first with `totem wt remove`.',
      'CONFIG_INVALID',
    );
  }

  fs.mkdirSync(root, { recursive: true });

  const entry: WorktreeEntry = {
    repo: repoRoot,
    seat,
    branch,
    ...(options.ticket === undefined ? {} : { ticket: options.ticket }),
    createdAt,
  };
  // Record-first: a registry write that fails here has touched no git state,
  // and there is nothing to clean up.
  await addWorktreeEntry({ worktreePath: target, entry, root });

  try {
    exec('git', ['-C', repoRoot, 'worktree', 'add', '-b', branch, target], {});
  } catch (err) {
    // A partial directory left by the failed add means the record must STAY:
    // deleting it would convert a VISIBLE phantom into exactly the invisible
    // unrecorded-worktree class this verb exists to prevent (#2580 slice-2
    // falsification, finding 6). Rollback only when nothing landed on disk.
    const partialLeft = worktreePathExists(target);
    const rollbackError = partialLeft ? undefined : await rollbackCreateEntry(target, createdAt);
    if (rollbackError !== undefined) {
      // `log.error` carries the 'Totem Error' tag — the packages/cli path
      // instruction (styleguide Rule 129), not this command's own TAG.
      log.error(
        'Totem Error',
        `PHANTOM ENTRY — ${render(target)} is recorded in ${render(worktreeRegistryPath())} but was never created, and the rollback failed: ${render(rollbackError)}`,
      );
    }
    const disposition = partialLeft
      ? ` (a partial directory was left on disk; the registry entry is RETAINED — clean up with \`totem wt remove ${render(target)}\`)`
      : rollbackError === undefined
        ? ' (registry entry rolled back)'
        : ` (registry entry NOT rolled back — remove it with \`totem wt remove ${render(target)}\`)`;
    throw new TotemGitError(
      `wt create: git worktree add failed for ${render(target)}: ${render(describe(err))}${disposition}`,
      `The branch ${branch} must not already exist and ${render(root)} must be writable.`,
      err,
    );
  }

  if (options.json === true) {
    writeJson({
      action: 'create',
      path: target,
      repo: repoRoot,
      seat,
      branch,
      ...(options.ticket === undefined ? {} : { ticket: options.ticket }),
      root,
      'root-source': rootSource,
      'created-at': createdAt,
    });
    return;
  }

  log.info(TAG, `${successColor(bold('created'))} ${render(target)}`);
  log.dim(
    TAG,
    `branch ${render(branch)} · seat ${render(seat)} · root ${render(root)} (${rootSource}) · recorded in ${render(worktreeRegistryPath())}`,
  );
}

function defaultBranchName(slug: string, ticket?: string): string {
  return ticket === undefined ? `wt/${slug}` : `feat/${ticket}-${slug}`;
}

// ─── remove ─────────────────────────────────────────────

/** How a removal resolved — reported so the taken path is never implicit. */
type RemoveOutcome = 'git-removed' | 'residue-removed' | 'already-gone';

interface ResolvedTarget {
  resolvedPath: string;
  entryKey?: string;
  entry?: WorktreeEntry;
}

/**
 * Remove a worktree and PROVE it is gone. Exit 0 is granted only by a
 * no-follow existence probe returning absent; every failure path retains the
 * registry entry so the problem stays visible in `wt list`.
 */
export async function wtRemoveCommand(options: WtRemoveOptions): Promise<void> {
  const core = await import('@mmnto/totem');
  const {
    deleteWorktreeEntry,
    findWorktreeEntry,
    readWorktreeRegistry,
    removeWorktreeResidue,
    TotemConfigError,
    TotemError,
    TotemGitError,
    worktreePathExists,
    worktreePathKey,
    worktreeRegistryPath,
  } = core;
  const {
    render,
    pathIsUnder,
    requireGitRoot,
    gitListedPaths,
    resolveRemoveTarget,
    assertEclClear,
  } = coreHelpers(core);

  const cwd = options.cwdForTest ?? process.cwd();
  const exec = options.execForTest ?? core.safeExec;
  const finishResidue: WtResidueFn =
    options.residueForTest ?? ((dir: string) => removeWorktreeResidue({ dir }));

  const warnings: string[] = [];
  const notes: string[] = [];
  const file = readWorktreeRegistry((msg) => warnings.push(msg));
  for (const warning of warnings) log.warn(TAG, render(warning));

  const { resolvedPath } = resolveRemoveTarget(options.target, cwd, Object.keys(file.worktrees));
  const found = findWorktreeEntry(file, resolvedPath);
  const resolved: ResolvedTarget = {
    resolvedPath,
    ...(found === undefined ? {} : { entryKey: found.key, entry: found.entry }),
  };

  // The home repo is the recorded one when there is an entry (the worktree's
  // OWN repo, which need not be the cwd's), else the repo we are standing in.
  const homeRepo =
    resolved.entry === undefined ? requireGitRoot(exec, cwd) : path.resolve(resolved.entry.repo);

  const onDisk = worktreePathExists(resolvedPath);

  // ECL first: a refusal must happen before anything is removed, and only a
  // directory that exists can hold orchestration content.
  if (onDisk) assertEclClear(exec, resolvedPath, notes);

  // Check-first. An unanswerable worktree list is a hard error WHEN the
  // directory exists — without git's answer we cannot tell a live worktree
  // (whose metadata a raw delete would strand) from residue. With nothing on
  // disk there is nothing to strand and nothing to delete, and the ruled
  // idempotent recovery (verified-absent + entry present ⇒ delete entry) must
  // not be blocked by a home repo that is itself gone (#2580 slice-2
  // falsification, finding 7).
  let listed: Set<string> | undefined;
  try {
    listed = gitListedPaths(exec, homeRepo);
  } catch (err) {
    if (onDisk) {
      throw new TotemGitError(
        `wt remove: cannot enumerate worktrees in ${render(homeRepo)}: ${render(describe(err))}`,
        `Check that the home repository still exists and is a readable git repo, then re-run. If the home repo itself is gone, the recorded entry has no removal to perform — delete it from ${render(worktreeRegistryPath())} by hand.`,
        err,
      );
    }
    listed = undefined;
    notes.push(
      `home repo ${render(homeRepo)} could not enumerate worktrees (${render(describe(err))}); nothing is on disk at ${render(resolvedPath)}, so no removal was owed`,
    );
  }
  const gitListed = listed !== undefined && listed.has(worktreePathKey(resolvedPath));

  if (!gitListed && resolved.entry === undefined) {
    throw new TotemConfigError(
      `wt remove: ${render(resolvedPath)} is in neither git's worktree list nor ${render(worktreeRegistryPath())} — nothing was touched`,
      'Pass a path this repo tracks as a worktree, or a name recorded by `totem wt list`. Unrecorded directories are never deleted by this verb.',
      'CONFIG_INVALID',
    );
  }

  let outcome: RemoveOutcome;
  let residue: ResidueRemovalResult | undefined;

  if (gitListed) {
    try {
      exec('git', ['-C', homeRepo, 'worktree', 'remove', '--force', resolvedPath], {});
    } catch (err) {
      throw new TotemGitError(
        `wt remove: git worktree remove failed for ${render(resolvedPath)}: ${render(describe(err))}`,
        'Resolve the cause (a locked worktree, a busy file) and re-run; the registry entry is retained.',
        err,
      );
    }
    outcome = 'git-removed';
  } else if (onDisk) {
    // Registry-known but git-unlisted: git has nothing to remove, so the
    // finish runs directly. `git worktree remove` is never invoked here — and
    // because the finish is an unconditional recursive delete, it only runs
    // where the registry itself proves worktrees live: strictly under a
    // recorded root. An entry OUTSIDE every recorded root is a hand-edit
    // anomaly, and handing it to a recursive delete would make a corrupted
    // worktrees.json an arbitrary-delete primitive (#2580 slice-2
    // falsification, finding 13).
    if (!file.roots.some((recorded) => pathIsUnder(resolvedPath, recorded))) {
      throw new TotemConfigError(
        `wt remove: ${render(resolvedPath)} is recorded but lies under none of the recorded roots — refusing the residue delete`,
        `Recorded roots: ${file.roots.map((r) => render(r)).join(', ') || '(none)'}. If the entry is a stale hand-edit, remove it from ${render(worktreeRegistryPath())} by hand.`,
        'CONFIG_INVALID',
      );
    }
    outcome = 'residue-removed';
  } else {
    outcome = 'already-gone';
    notes.push('directory was already absent; the registry entry was stale');
  }

  // Verify. Git's exit code is not evidence — this probe is.
  if (worktreePathExists(resolvedPath)) {
    residue = await finishResidue(resolvedPath);
    if (outcome === 'git-removed') outcome = 'residue-removed';
    // Re-verify: the finish reports, it does not assert.
    if (!residue.removed || worktreePathExists(resolvedPath)) {
      const survivors = residue.survivors.length > 0 ? residue.survivors : [resolvedPath];
      throw new TotemError(
        'CHECK_FAILED',
        `wt remove: ${render(resolvedPath)} still exists after the residue finish — surviving: ${survivors.map((s) => render(s)).join(', ')}${
          residue.lastError === undefined ? '' : ` (last error: ${render(residue.lastError)})`
        }`,
        'Remove the survivors manually, then re-run `totem wt remove` — the registry entry is retained so the failure stays visible in `totem wt list`.',
      );
    }
  }

  // Verified absent from here down: the entry may go — but only the ENTRY THIS
  // RUN FOUND. A concurrent `wt create` can re-record the same path inside the
  // verify→delete window, and an unguarded delete-by-path would erase the
  // replacement's durable record (bot round, Greptile P1) — the `createdAt`
  // guard makes the delete conditional on identity.
  let entryDeleted = false;
  let entryDisposition = 'not recorded (nothing to delete)';
  if (resolved.entryKey !== undefined && resolved.entry !== undefined) {
    // totem-context: intentional cleanup — the directory is verifiably gone, so a failed registry delete is a stale RECORD, not a failed removal; it warns and the exit stays 0 (re-running the verb is idempotent and clears it).
    try {
      entryDeleted = await deleteWorktreeEntry(resolved.entryKey, {
        expectCreatedAt: resolved.entry.createdAt,
      });
      if (entryDeleted) {
        entryDisposition = 'deleted';
      } else if (findWorktreeEntry(readWorktreeRegistry(), resolvedPath) !== undefined) {
        // The guard refused: a fresh entry now stands at the path, and it
        // belongs to the replacement — leaving it is the correct outcome, but
        // never a silent one.
        entryDisposition = 'replaced concurrently — left in place';
        log.warn(
          TAG,
          `${render(resolvedPath)}: the registry entry was replaced concurrently (a fresh \`wt create\` re-recorded the path) — left in place for the replacement`,
        );
      } else {
        entryDisposition = 'already cleared (concurrent removal)';
      }
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch (err) {
      entryDisposition = 'retained (delete failed)';
      log.warn(
        TAG,
        `${render(resolvedPath)} is gone but its registry entry could not be deleted (${render(describe(err))}) — re-run \`totem wt remove\` to clear it`,
      );
    }
  }

  // totem-context: intentional cleanup — prune is registry HYGIENE in the home repo, run after the removal is already verified; a prune failure must not flip an exit code whose whole contract is "the directory is gone".
  try {
    exec('git', ['-C', homeRepo, 'worktree', 'prune'], {});
    // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
  } catch (err) {
    log.warn(
      TAG,
      `git worktree prune failed in ${render(homeRepo)} (${render(describe(err))}) — stale metadata may remain`,
    );
  }

  if (options.json === true) {
    writeJson({
      action: 'remove',
      path: resolvedPath,
      repo: homeRepo,
      outcome,
      'git-listed': gitListed,
      // Re-derived at write time — the artifact carries evidence, not a
      // control-flow assumption (a literal `true` would survive a race).
      'verified-absent': !worktreePathExists(resolvedPath),
      'registry-entry-deleted': entryDeleted,
      ...(residue === undefined ? {} : { 'stripped-links': residue.strippedLinks }),
      ...(notes.length === 0 ? {} : { notes }),
    });
    return;
  }

  log.info(TAG, `${successColor(bold('removed'))} ${render(resolvedPath)} (${outcome})`);
  if (residue !== undefined && residue.strippedLinks.length > 0) {
    log.dim(
      TAG,
      `stripped ${residue.strippedLinks.length} link(s) without following them: ${residue.strippedLinks.map((l) => render(l)).join(', ')}`,
    );
  }
  for (const note of notes) log.dim(TAG, note);
  log.dim(TAG, `registry entry ${entryDisposition} · verified absent`);
}

// ─── list ───────────────────────────────────────────────

/**
 * Accounting only: what was recorded, and whether it is on disk. Whether a
 * worktree is active or stale is NOT decided here — that classification lives
 * in the slice-1 sensor (`totem doctor --estate`), and duplicating it would
 * mint a second, drifting answer to the same question.
 */
export async function wtListCommand(options: WtListOptions = {}): Promise<void> {
  const core = await import('@mmnto/totem');
  const { existingWorktreeRoots, readWorktreeRegistry, worktreePathExists, worktreeRegistryPath } =
    core;
  const { render } = coreHelpers(core);

  const now = options.nowForTest ?? Date.now();
  const warnings: string[] = [];
  const file = readWorktreeRegistry((msg) => warnings.push(msg));
  // A warning always implies zero entries — a broken file must never render as
  // "no worktrees recorded" (the doctor-estate registry-status precedent).
  for (const warning of warnings) log.warn(TAG, render(warning));

  const rows = Object.entries(file.worktrees)
    .map(([wtPath, entry]) => ({
      path: path.resolve(wtPath),
      entry,
      present: worktreePathExists(wtPath),
      age: ageDays(entry.createdAt, now),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  if (options.json === true) {
    writeJson({
      action: 'list',
      'registry-status': warnings.length > 0 ? 'unreadable' : rows.length === 0 ? 'empty' : 'ok',
      'schema-version': file.schemaVersion,
      roots: file.roots.map((root) => path.resolve(root)),
      worktrees: rows.map((row) => ({
        path: row.path,
        repo: row.entry.repo,
        seat: row.entry.seat,
        branch: row.entry.branch,
        ...(row.entry.ticket === undefined ? {} : { ticket: row.entry.ticket }),
        'created-at': row.entry.createdAt,
        ...(row.age === undefined ? {} : { 'age-days': row.age }),
        present: row.present,
      })),
    });
    return;
  }

  if (rows.length === 0) {
    log.dim(
      TAG,
      warnings.length > 0
        ? `no listing — ${render(worktreeRegistryPath())} could not be read`
        : `no worktrees recorded in ${render(worktreeRegistryPath())}`,
    );
    return;
  }

  log.info(TAG, bold(`── recorded worktrees (${rows.length}) ──`));
  for (const row of rows) {
    const state = row.present ? successColor('present') : warnColor('missing');
    const age = row.age === undefined ? 'age unknown' : `${row.age}d old`;
    const ticket = row.entry.ticket === undefined ? '' : ` · #${render(row.entry.ticket)}`;
    log.info(
      TAG,
      `${state} ${render(row.path)} [${render(row.entry.branch)}] · seat ${render(row.entry.seat)}${ticket} · ${age}`,
    );
  }
  const roots = existingWorktreeRoots(file);
  log.dim(
    TAG,
    `${file.roots.length} recorded root(s), ${roots.length} present on disk: ${roots.map((r) => render(r)).join(', ')}`,
  );
  log.dim(
    TAG,
    'accounting only — `present`/`missing` is disk state, not liveness. Whether a worktree is active or stale is `totem doctor --estate`.',
  );
}
