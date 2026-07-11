// Pure git utilities — delegated to core, re-exported for backward compatibility
export {
  extractChangedFiles,
  filterDiffByPatterns,
  getDefaultBranch,
  getGitBranch,
  getGitBranchDiff,
  getGitDiff,
  getGitDiffRange,
  getGitDiffStat,
  getGitLogSince,
  getGitStatus,
  getLatestTag,
  getTagDate,
  isFileDirty,
  resolveGitRoot,
} from '@mmnto/totem';

import { safeExec } from '@mmnto/totem';

// ─── Incremental shield helpers (#1010) ─────────────────

/**
 * Check if `base` is an ancestor of `head` (or HEAD if omitted).
 * Returns true if `git merge-base --is-ancestor` exits 0.
 */
export function isAncestor(cwd: string, base: string, head?: string): boolean {
  try {
    safeExec('git', ['merge-base', '--is-ancestor', base, head ?? 'HEAD'], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get shortstat between two refs. Returns parsed line counts.
 */
export function getShortstat(
  cwd: string,
  base: string,
  head?: string,
): { files: number; insertions: number; deletions: number } {
  try {
    const output = safeExec('git', ['diff', '--shortstat', base, head ?? 'HEAD'], { cwd });
    const files = parseInt(output.match(/(\d+) file/)?.[1] ?? '0', 10);
    const insertions = parseInt(output.match(/(\d+) insertion/)?.[1] ?? '0', 10);
    const deletions = parseInt(output.match(/(\d+) deletion/)?.[1] ?? '0', 10);
    return { files, insertions, deletions };
  } catch {
    return { files: 0, insertions: 0, deletions: 0 };
  }
}

/**
 * Get file statuses between two refs. Returns array of { status, file }.
 * Status is 'A' (added), 'M' (modified), 'D' (deleted), etc.
 */
export function getNameStatus(
  cwd: string,
  base: string,
  head?: string,
): Array<{ status: string; file: string }> {
  try {
    const output = safeExec('git', ['diff', '--name-status', base, head ?? 'HEAD'], { cwd });
    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [status, ...rest] = line.split('\t');
        return { status: status ?? '', file: rest.join('\t') };
      });
  } catch {
    return [];
  }
}

/**
 * Get the diff between two refs.
 */
export function getDiffBetween(cwd: string, base: string, head?: string): string {
  try {
    return safeExec('git', ['diff', base, head ?? 'HEAD'], { cwd, maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return '';
  }
}

// ─── Diff-for-review helper (CLI-only — uses log from ui.js) ─────

export type DiffForReviewSource = 'explicit-range' | 'staged' | 'uncommitted' | 'branch-vs-base';

export interface DiffForReviewOptions {
  staged?: boolean;
  /** Explicit ref range (mmnto-ai/totem#1717). When set, bypasses the implicit fallback chain. */
  diff?: string;
  /**
   * Force the branch-vs-base (push-gate) diff scope regardless of working-tree
   * state (mmnto-ai/totem#2091). Mutually exclusive with `staged` and `diff`.
   */
  branch?: boolean;
  /**
   * Explicit base branch NAME for the forced branch-vs-base scope
   * (mmnto-ai/totem#2091). Resolved through `getGitBranchDiff`'s
   * origin-preference logic (`origin/<base>...HEAD`, else local `<base>` —
   * mmnto-ai/totem#2054); NOT a raw ref range. Setting `base` implies
   * `branch`. Mutually exclusive with `staged` and `diff`.
   */
  base?: string;
  /**
   * Lint-only opt-in for the narrow-scope advisory (mmnto-ai/totem#2090).
   * When the resolved source is `staged`/`uncommitted` and the branch-vs-base
   * scope the pre-push gate checks would cover more files, a one-line warning
   * names the gap. Never set by `review` — staged-slice review is routinely
   * intentional (truncation-cliff workaround), so warning there trains ignore.
   */
  warnNarrowScope?: boolean;
}

export interface DiffForReviewConfig {
  ignorePatterns: string[];
  shieldIgnorePatterns?: string[];
}

export interface DiffForReviewResult {
  diff: string;
  changedFiles: string[];
  /** Which path produced the diff (mmnto-ai/totem#1717 — surfaced for operator-visible logging). */
  source: DiffForReviewSource;
  /**
   * Resolved base ref for the scope, captured at derivation time (Prop 304
   * verdict `diffScope`). Present only where the source makes it meaningful:
   * the resolved base branch name for `branch-vs-base`, the range's base
   * endpoint for `explicit-range`. Omitted for `staged`/`uncommitted` (no base
   * ref participates). Recorded here so downstream consumers never reconstruct
   * the scope refs from flags after the fact.
   */
  base?: string;
  /**
   * Resolved head ref for the scope, captured at derivation time (Prop 304
   * verdict `diffScope`). Present only for `explicit-range` (the range's head
   * endpoint). Omitted for `branch-vs-base` (head is the working `HEAD`, not a
   * scope-distinguishing ref) and for `staged`/`uncommitted`.
   */
  head?: string;
}

/**
 * Resolve the base/head endpoints of an explicit `--diff` range for scope
 * metadata (Prop 304). Records the refs the operator named, at derivation
 * time, so the verdict artifact never reconstructs them later. Mirrors git's
 * range grammar: three-dot (`A...B`) is tested before two-dot (`A..B`); an
 * omitted side defaults to `HEAD` (`A..` ≡ `A..HEAD`, `..B` ≡ `HEAD..B`); a
 * bare ref (`git diff A`, which compares against the working tree) yields only
 * a named `base`, leaving `head` undefined.
 */
function resolveExplicitRangeRefs(range: string): { base?: string; head?: string } {
  const trimmed = range.trim();
  for (const sep of ['...', '..'] as const) {
    const idx = trimmed.indexOf(sep);
    if (idx !== -1) {
      const left = trimmed.slice(0, idx).trim();
      const right = trimmed.slice(idx + sep.length).trim();
      return {
        base: left.length > 0 ? left : 'HEAD',
        head: right.length > 0 ? right : 'HEAD',
      };
    }
  }
  return trimmed.length > 0 ? { base: trimmed } : {};
}

/**
 * Maximum diff size (in characters) before the prompt assembler truncates.
 * Mirrored from `shield-templates.MAX_DIFF_CHARS` so the resolution-layer
 * warning fires on the same threshold as the actual truncation site.
 *
 * Kept as a separate constant here rather than imported from
 * `commands/shield-templates.ts` to avoid a circular CLI dependency
 * (`git.ts` is intended to be substrate for many commands, not just review).
 */
export const REVIEW_DIFF_TRUNCATION_THRESHOLD = 50_000;

/**
 * Shared diff-fetching logic used by both `shield` and `lint` commands.
 *
 * Resolution order:
 *   1. `--branch` / `--base <ref>` (forced push-gate scope, mmnto-ai/totem#2091 —
 *      jumps straight to the branch-vs-base diff of step 4, ignoring the
 *      working tree; mutually exclusive with 2 and 3)
 *   2. `--diff <range>` (explicit, no fallback)
 *   3. `--staged` (staged-only) or working-tree (`all`) diff
 *   4. Branch-vs-base diff (`<default>...HEAD`) when 3 yields nothing
 *
 * The chosen resolution path is logged to stderr (mmnto-ai/totem#1717) so the operator's
 * mental model matches the actual git invocation. Diffs exceeding
 * `REVIEW_DIFF_TRUNCATION_THRESHOLD` chars surface a warning here, before
 * the LLM call is made, so the operator can re-run with a narrower
 * `--diff <range>` instead of paying for a degraded review.
 *
 * Returns `null` when no changes are detected.
 */
export async function getDiffForReview(
  options: DiffForReviewOptions,
  config: DiffForReviewConfig,
  cwd: string,
  tag: string,
): Promise<DiffForReviewResult | null> {
  const { log } = await import('./ui.js');
  const {
    TotemError,
    TotemGitError,
    extractChangedFiles,
    filterDiffByPatterns,
    getDefaultBranch,
    getGitBranchDiff,
    getGitDiff,
    getGitDiffRange,
    sanitizeForTerminal,
  } = await import('@mmnto/totem');

  // ── Eager scope-selector validation (mmnto-ai/totem#2091) ──
  // `--base` implies branch scope. Both are mutually exclusive with the
  // other explicit scope selectors — validated BEFORE any git work so the
  // error names the conflicting flags instead of silently preferring one
  // scope (the implicit-scope dishonesty mmnto-ai/totem#2055 exists to kill).
  const forcedBranchScope = options.branch === true || options.base !== undefined;
  // Names the flag(s) the user actually passed — shared by the conflict error
  // AND the diff-source disclosure line so neither cites a flag that wasn't
  // given (a `--base`-only run must not log `--branch` — Greptile on #2098).
  const forcingFlags = [
    ...(options.branch ? ['--branch'] : []),
    ...(options.base !== undefined ? ['--base'] : []),
  ].join('/');
  if (forcedBranchScope) {
    const conflicting = [
      ...(options.staged ? ['--staged'] : []),
      ...(options.diff !== undefined ? ['--diff'] : []),
    ];
    if (conflicting.length > 0) {
      throw new TotemError(
        'FLAG_CONFLICT',
        `${forcingFlags} cannot be combined with ${conflicting.join(', ')}: each selects a different diff scope, and silent precedence would hide which scope actually ran.`,
        'Re-run with exactly one scope selector: --branch/--base <ref>, --staged, or --diff <range>.',
      );
    }
    if (options.base !== undefined) {
      // Mirrors getGitDiffRange's flag-injection guard (mmnto-ai/totem#1717):
      // reject empty values and leading `-` before the name reaches git.
      const trimmedBase = options.base.trim();
      if (trimmedBase.length === 0) {
        throw new TotemGitError(
          'Empty base branch supplied to --base.',
          'Provide a non-empty branch name, e.g. --base main.',
        );
      }
      if (trimmedBase.startsWith('-')) {
        throw new TotemGitError(
          `Invalid base branch: ${trimmedBase}. Branch names may not start with '-' (git-flag injection guard).`,
          'Provide a plain branch name such as "main" without leading dashes.',
        );
      }
    }
  }

  const allIgnore = [...config.ignorePatterns, ...(config.shieldIgnorePatterns ?? [])];

  let diff: string;
  let source: DiffForReviewSource;
  // Scope refs resolved at derivation time (Prop 304). Populated only where the
  // source makes them meaningful; left undefined otherwise.
  let scopeBase: string | undefined;
  let scopeHead: string | undefined;

  if (forcedBranchScope) {
    // Forced push-gate scope (mmnto-ai/totem#2091): bypass the working-tree
    // checks entirely and diff branch-vs-base — exactly what the pre-push
    // gate evaluates. Reuses the auto-fallback's source value so downstream
    // consumers treat forced and auto branch scope identically; the log line
    // discloses the forcing. getGitBranchDiff's TotemGitError (with its
    // "git fetch origin <ref>" hint) bubbles when the base resolves nowhere.
    const base = options.base !== undefined ? options.base.trim() : getDefaultBranch(cwd);
    const safeBase = sanitizeForTerminal(base);
    log.info(
      tag,
      `Diff source: branch-vs-base (${forcingFlags}; origin/${safeBase}...HEAD, else local ${safeBase})`,
    );
    diff = filterDiffByPatterns(getGitBranchDiff(cwd, base), allIgnore);
    source = 'branch-vs-base';
    scopeBase = base;
    if (!diff.trim()) {
      log.warn(tag, 'No changes detected. Nothing to review.');
      return null;
    }
  } else if (options.diff !== undefined) {
    // Explicit-range path — no fallback. getGitDiffRange rejects flag-injection
    // (leading `-`) and empty values; ignore patterns still apply per repo policy.
    log.info(tag, `Diff source: explicit range (${options.diff})`);
    diff = filterDiffByPatterns(getGitDiffRange(cwd, options.diff), allIgnore);
    source = 'explicit-range';
    ({ base: scopeBase, head: scopeHead } = resolveExplicitRangeRefs(options.diff));
    if (!diff.trim()) {
      log.warn(tag, `Explicit range '${options.diff}' produced no diff. Nothing to review.`);
      return null;
    }
  } else {
    const mode: 'staged' | 'all' = options.staged ? 'staged' : 'all';
    const sourceLabel: DiffForReviewSource = options.staged ? 'staged' : 'uncommitted';
    log.info(tag, `Diff source: ${sourceLabel}`);
    diff = filterDiffByPatterns(getGitDiff(mode, cwd), allIgnore);
    source = sourceLabel;

    if (!diff.trim()) {
      const base = getDefaultBranch(cwd);
      // Sanitize the git-derived branch name before logging (terminal-injection
      // hardening). Name both refs in resolution order so the line isn't
      // misleading when the offline fallback to the local ref fires (mmnto-ai/totem#2054).
      const safeBase = sanitizeForTerminal(base);
      log.info(
        tag,
        `Diff source: branch-vs-base (origin/${safeBase}...HEAD, else local ${safeBase})`,
      );
      diff = filterDiffByPatterns(getGitBranchDiff(cwd, base), allIgnore);
      source = 'branch-vs-base';
      scopeBase = base;
    }

    if (!diff.trim()) {
      log.warn(tag, 'No changes detected. Nothing to review.');
      return null;
    }
  }

  if (diff.length > REVIEW_DIFF_TRUNCATION_THRESHOLD) {
    log.warn(
      tag,
      `Diff exceeds ${REVIEW_DIFF_TRUNCATION_THRESHOLD} chars (${diff.length}). LLM review will see truncated content; re-run with a narrower --diff <range> to avoid degraded findings.`,
    );
  }

  const changedFiles = extractChangedFiles(diff);
  log.info(tag, `Changed files (${changedFiles.length}): ${changedFiles.join(', ')}`);

  // ── Narrow-scope advisory (mmnto-ai/totem#2090) — lint-only opt-in ──
  // When lint resolved a working-tree scope, compare against the
  // branch-vs-base scope the pre-push gate checks. The branch file set runs
  // through the SAME post-ignore-filter pipeline as the gate would, so N
  // counts only files the gate would actually lint (raw `--name-only`
  // overcounts ignored files). Set difference avoids double-counting files
  // changed both on the branch and in the working tree.
  if (options.warnNarrowScope && (source === 'staged' || source === 'uncommitted')) {
    try {
      const branchDiff = filterDiffByPatterns(
        getGitBranchDiff(cwd, getDefaultBranch(cwd)),
        allIgnore,
      );
      const branchFiles = extractChangedFiles(branchDiff);
      const currentScope = new Set(changedFiles);
      const unlinted = branchFiles.filter((file) => !currentScope.has(file));
      if (unlinted.length > 0) {
        const opening =
          source === 'staged' ? 'Linting staged changes only' : 'Linting uncommitted changes only';
        log.warn(
          tag,
          `${opening} — the pre-push gate checks the full branch (${unlinted.length} more file(s)). Lint a clean tree or use \`totem lint --branch\` to match.`,
        );
      }
      // totem-context: Tenet-4-justified silent skip (mmnto-ai/totem#2090) — the warning is a best-effort advisory ABOUT scope, not a verdict input; its failure states (detached HEAD, no base branch, shallow clone) are exactly where branch-vs-base scope is undefined, so there is no honest warning to emit. Lint's verdict, diff, and exit code are untouched.
    } catch {
      // Intentionally silent — see the totem-context justification above.
    }
  }

  return { diff, changedFiles, source, base: scopeBase, head: scopeHead };
}
