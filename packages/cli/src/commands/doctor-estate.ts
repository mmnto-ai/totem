/**
 * `totem doctor --estate` — the worktree-estate sensor's surface
 * (mmnto-ai/totem#2580 slice-1).
 *
 * Report-only by construction: the scan reads, this file renders, and neither
 * removes anything (removal verbs are a later slice). Exit stays 0 in every
 * sensor outcome — a husk, a stale worktree, and a failed probe are all
 * findings to show, not gate failures.
 *
 * Two surfaces, never both: the human render goes to stderr via the shared ui
 * log helpers, and `--json` replaces it wholesale with a diffable artifact that
 * owns stdout (the doctor-parity.ts:1507 verdict-artifact discipline —
 * kebab-case keys, no `json-output.ts` envelope, `estate-schema-version` as the
 * compatibility contract with the status lane).
 *
 * Core is dynamic-imported so `@mmnto/totem` stays off the CLI cold-start
 * graph, matching every other doctor check.
 */

import type { EstateExecFn, EstateScanResult, TotemRegistry } from '@mmnto/totem';

const TAG = 'Estate';

/**
 * How the registry read went. `unreadable` is kept distinct from `empty`
 * because `readRegistry` warns and returns `{}` on a corrupt or unreadable
 * file — collapsing that into "nothing registered" would report a broken
 * registry as a clean estate.
 */
type RegistryStatus = 'ok' | 'empty' | 'unreadable';

export interface EstateCliOptions {
  /**
   * Emit the scan as the JSON artifact on stdout INSTEAD of the human render.
   * The artifact is diffable, so nothing else may share stdout.
   */
  json?: boolean;
  /** Extra sweep roots (`--root`, repeatable), resolved against the cwd. */
  roots?: string[];
  /** Test seam — production callers omit and the command uses `process.cwd()`. */
  cwdForTest?: string;
  /** Test seam — bypasses the user-level `~/.totem/registry.json` read. */
  registryForTest?: TotemRegistry;
  /** Test seam — canned git, so the render is testable without a real estate. */
  execForTest?: EstateExecFn;
  /** Test seam — pins `derivedAt` and every `age-days` value. */
  nowForTest?: number;
  /**
   * Test seam — bypasses the user-level `~/.totem/worktrees.json` read that
   * supplies the wt-registry's recorded container roots.
   */
  wtRootsForTest?: string[];
}

/** Gutter width for row labels, so every row family aligns on one column. */
const LABEL_WIDTH = 13;

/** Row labels are the class names with the `registered-` scope prefix dropped. */
function classLabel(cls: string): string {
  return cls.startsWith('registered-') ? cls.slice('registered-'.length) : cls;
}

/**
 * The `--json` artifact. Optional keys are PRESENCE-ONLY (emitted or absent,
 * never `false`/`null`) so a consumer cannot mistake "not probed" for "probed
 * and negative" — the same convention as the parity readout's `last-attested`.
 */
function estateJsonArtifact(
  result: EstateScanResult,
  registryStatus: RegistryStatus,
): Record<string, unknown> {
  return {
    'estate-schema-version': result.schemaVersion,
    'registry-status': registryStatus,
    'derived-at': result.derivedAt,
    // Each root carries its KIND: the kind is what decided the evidence bar
    // inside it, so a consumer reading a husk row can tell which bar produced
    // it without re-deriving the roots.
    'swept-roots': result.sweptRoots.map((r) => ({ path: r.path, kind: r.kind })),
    // Additive under schema-version 1: the contract has no consumer yet, and a
    // narrowed sweep that nothing discloses is the silent degradation the
    // swept-roots disclosure exists to prevent.
    'excluded-roots': result.excludedRoots.map((r) => ({ path: r.path, reason: r.reason })),
    repos: result.repos.map((r) => ({
      path: r.path,
      ...(r.lastSync !== undefined ? { 'last-sync': r.lastSync } : {}),
      ...(r.missing === true ? { missing: true } : {}),
      ...(r.notGitRoot === true ? { 'not-git-root': true } : {}),
      ...(r.enclosingRepo !== undefined ? { 'enclosing-repo': r.enclosingRepo } : {}),
      ...(r.defaultBranch !== undefined ? { 'default-branch': r.defaultBranch } : {}),
      worktrees: r.worktrees,
    })),
    worktrees: result.worktrees.map((w) => ({
      path: w.path,
      'repo-path': w.repoPath,
      ...(w.branch !== undefined ? { branch: w.branch } : {}),
      ...(w.head !== undefined ? { head: w.head } : {}),
      class: w.class,
      ...(w.dirty === true ? { dirty: true } : {}),
      'ancestry-merged': w.ancestryMerged,
      ...(w.ageDays !== undefined ? { 'age-days': w.ageDays } : {}),
      ...(w.locked === true ? { locked: true } : {}),
      ...(w.prunable === true ? { prunable: true } : {}),
      evidence: w.evidence,
    })),
    'husk-candidates': result.huskCandidates.map((h) => ({
      path: h.path,
      'swept-root': h.sweptRoot,
      evidence: h.evidence,
      ...(h.matchedRepo !== undefined ? { 'matched-repo': h.matchedRepo } : {}),
      ...(h.ageDays !== undefined ? { 'age-days': h.ageDays } : {}),
    })),
    unscannable: result.unscannable.map((u) => ({
      path: u.path,
      reason: u.reason,
      source: u.source,
    })),
    summary: {
      repos: result.summary.repos,
      'repos-missing': result.summary.reposMissing,
      'repos-not-git-root': result.summary.reposNotGitRoot,
      'repos-unscannable': result.summary.reposUnscannable,
      worktrees: result.summary.worktrees,
      active: result.summary.active,
      stale: result.summary.stale,
      indeterminate: result.summary.indeterminate,
      detached: result.summary.detached,
      'unscannable-worktrees': result.summary.unscannableWorktrees,
      'husk-candidates': result.summary.huskCandidates,
      unscannable: result.summary.unscannable,
    },
  };
}

/**
 * The degenerate artifact for an empty or unreadable registry: the same shape
 * carrying the computed `registry-status`, so a consumer can tell "nothing
 * registered" from "registry unreadable" from "scanned and found nothing"
 * (doctor-parity.ts:1528 precedent).
 */
function degenerateArtifact(
  now: number,
  registryStatus: RegistryStatus,
  // The core constant, passed in from the command's dynamic import so this
  // helper stays synchronous and the literal has one source of truth.
  schemaVersion: EstateScanResult['schemaVersion'],
): Record<string, unknown> {
  return estateJsonArtifact(
    {
      schemaVersion,
      derivedAt: new Date(now).toISOString(),
      sweptRoots: [],
      excludedRoots: [],
      repos: [],

      worktrees: [],
      huskCandidates: [],
      unscannable: [],
      summary: {
        repos: 0,
        reposMissing: 0,
        reposNotGitRoot: 0,
        reposUnscannable: 0,
        worktrees: 0,
        active: 0,
        stale: 0,
        indeterminate: 0,
        detached: 0,
        unscannableWorktrees: 0,
        huskCandidates: 0,
        unscannable: 0,
      },
    },
    registryStatus,
  );
}

export async function doctorEstateCliCommand(options: EstateCliOptions = {}): Promise<void> {
  const path = await import('node:path');
  const {
    ESTATE_SCHEMA_VERSION,
    existingWorktreeRoots,
    readRegistry,
    readWorktreeRegistry,
    safeExec,
    sanitizeForTerminal,
    scanEstate,
  } = await import('@mmnto/totem');
  const {
    bold,
    dim: dimColor,
    log,
    success: successColor,
    warn: warnColor,
  } = await import('../ui.js');

  // Paths, branch names, and git error text all originate outside this process;
  // sanitize + flatten before logging so embedded ANSI / newlines cannot forge
  // extra doctor lines (matches doctorParityCliCommand and checkStrategyRoot).
  const render = (text: string): string =>
    sanitizeForTerminal(text)
      .replace(/[\t\n]+/g, ' ')
      .replace(/ {2,}/g, ' ')
      .trim();

  const cwd = options.cwdForTest ?? process.cwd();
  const now = options.nowForTest ?? Date.now();

  const registryWarnings: string[] = [];
  const registry =
    options.registryForTest ?? readRegistry((msg: string) => registryWarnings.push(msg));
  const entries = Object.values(registry).map((entry) => ({
    path: entry.path,
    lastSync: entry.lastSync,
  }));

  // `readRegistry` warns only when it swallowed a non-ENOENT read/parse failure
  // and returned `{}`, so a warning always implies zero entries — and means
  // "unreadable", not "empty".
  const registryStatus: RegistryStatus =
    registryWarnings.length > 0 ? 'unreadable' : entries.length === 0 ? 'empty' : 'ok';

  // Warnings ride stderr in EVERY mode, ahead of the artifact write: stderr is
  // not the artifact, and dropping the one signal that the registry is broken
  // would be exactly the silent degradation this sensor exists to surface.
  for (const warning of registryWarnings) log.warn(TAG, render(warning));

  // The wt-registry's recorded roots (mmnto-ai/totem#2580 slice 2, round-3
  // MINOR-3): every container root `totem wt create` has ever minted under,
  // swept with the same CONTAINER semantics an operator's `--root` confers.
  // This is what keeps a recorded location reachable once the last live entry
  // under it is gone — with only the derived roots, an emptied container is
  // invisible to the sweep and every husk in it goes unreported.
  //
  // Unreadable file: warn and proceed with the derived roots (the
  // container-withdrawal precedent — a degraded scan may report LESS, never
  // more). Recorded roots that no longer exist are filtered out inside
  // `existingWorktreeRoots`: an absent root is an empty sweep, not a hole.
  const wtWarnings: string[] = [];
  const wtRoots =
    options.wtRootsForTest ??
    existingWorktreeRoots(readWorktreeRegistry((msg: string) => wtWarnings.push(msg)));
  for (const warning of wtWarnings) log.warn(TAG, render(warning));

  const extraRoots = [...(options.roots ?? []).map((root) => path.resolve(cwd, root)), ...wtRoots];

  // The empty-registry short-circuit yields ONLY when there is also nothing to
  // sweep: `--root` declares a worktree location independently of the registry,
  // the wt-registry's recorded roots do the same, and `scanEstate` sweeps
  // `extraRoots` with `registry: []` — dropping them here would kill both
  // exactly when the registry is useless.
  if (entries.length === 0 && extraRoots.length === 0) {
    if (options.json) {
      process.stdout.write(
        JSON.stringify(degenerateArtifact(now, registryStatus, ESTATE_SCHEMA_VERSION), null, 2) +
          '\n',
      );
      return;
    }
    log.dim(
      TAG,
      registryStatus === 'unreadable'
        ? 'SKIP — ~/.totem/registry.json could not be read; no repos to scan'
        : 'SKIP — no registered repos in ~/.totem/registry.json; run `totem sync` in a repo to register it',
    );
    return;
  }

  const result = scanEstate({
    registry: entries,
    safeExec: options.execForTest ?? safeExec,
    now,
    extraRoots,
  });

  if (options.json) {
    process.stdout.write(
      JSON.stringify(estateJsonArtifact(result, registryStatus), null, 2) + '\n',
    );
    return;
  }

  const s = result.summary;
  log.info(TAG, bold('── worktree estate ──'));
  log.info(
    TAG,
    `${s.repos} registered repo(s) · ${s.worktrees} linked worktree(s) · swept ${result.sweptRoots.length} root(s): ${result.sweptRoots
      .map((r) => `${render(r.path)} (${r.kind})`)
      .join(', ')}`,
  );
  for (const excluded of result.excludedRoots) {
    log.dim(TAG, `not swept: ${render(excluded.path)} — ${render(excluded.reason)}`);
  }

  for (const repo of result.repos) {
    if (repo.missing === true) {
      log.info(
        TAG,
        `${warnColor(bold('[MISSING]  '))} ${render(repo.path)} — registry path does not exist`,
      );
      continue;
    }
    if (repo.notGitRoot === true) {
      log.info(
        TAG,
        `${warnColor(bold('[NOT GIT ROOT]'))} ${render(repo.path)} — inside ${render(repo.enclosingRepo ?? 'an enclosing repo')}, not a git toplevel; not enumerated`,
      );
      continue;
    }
    const branch =
      repo.defaultBranch === undefined
        ? 'default branch underivable'
        : `default ${render(repo.defaultBranch)}`;
    log.dim(TAG, `repo ${render(repo.path)} — ${branch} · ${repo.worktrees} worktree(s)`);
  }

  for (const row of result.worktrees) {
    const label = classLabel(row.class).padEnd(LABEL_WIDTH);
    const color =
      row.class === 'registered-active'
        ? successColor
        : row.class === 'registered-stale' || row.class === 'unscannable'
          ? warnColor
          : dimColor;
    const branch = row.branch === undefined ? '(detached)' : `[${render(row.branch)}]`;
    const flags = [row.locked === true ? 'locked' : '', row.prunable === true ? 'prunable' : '']
      .filter((f) => f.length > 0)
      .join(' · ');
    const flagSuffix = flags.length > 0 ? ` · ${flags}` : '';
    log.info(
      TAG,
      `${color(bold(label))} ${render(row.path)} ${branch} — ${render(row.evidence)}${flagSuffix}`,
    );
  }

  for (const husk of result.huskCandidates) {
    const age = husk.ageDays === undefined ? '' : ` · mtime ${husk.ageDays}d ago`;
    const matched = husk.matchedRepo === undefined ? '' : ` · matches ${render(husk.matchedRepo)}`;
    log.info(
      TAG,
      `${warnColor(bold('husk'.padEnd(LABEL_WIDTH)))} ${render(husk.path)} [${husk.evidence}] under ${render(husk.sweptRoot)}${matched}${age}`,
    );
  }

  for (const row of result.unscannable) {
    // The axis is printed: a registry-source row is registered-arm accounting
    // and may share a path with a husk row, while a sweep-source row is a hole
    // in the candidate scan. Collapsing them would hide which is which.
    log.info(
      TAG,
      `${warnColor(bold('unscannable'.padEnd(LABEL_WIDTH)))} [${row.source}] ${render(row.path)} — ${render(row.reason)}`,
    );
  }

  log.info(
    TAG,
    `${s.worktrees} worktree(s): ${s.active} active · ${s.stale} stale · ${s.indeterminate} indeterminate · ${s.detached} detached · ${s.unscannableWorktrees} unscannable — plus ${s.huskCandidates} husk candidate(s) · ${s.unscannable} unscannable probe(s)`,
  );
  log.dim(
    TAG,
    'indeterminate = clean but not ancestry-merged: a squash-merged branch is indistinguishable from an unmerged one without a merged-facts source, so this sensor declines to claim either.',
  );
  log.dim(
    TAG,
    'husk criteria by root kind — container roots (`<repo>/.claude/worktrees` and any --root) use LOCATION as evidence: ANY directory git tracks no worktree for and that has no `.git` directory is reported there, typed as dangling-gitdir-pointer or deregistered-intact when a `.git` pointer supplies stronger evidence and container-residue otherwise. Standard roots (parents of registry paths and of listed worktrees) require SHAPE evidence: a dangling `.git` pointer · no `.git` + verified-repo name prefix + node_modules · an intact pointer absent from its home repo worktree list. Report-only — nothing is removed.',
  );
}
