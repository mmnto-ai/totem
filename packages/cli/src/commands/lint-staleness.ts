/**
 * Compile-manifest staleness delta naming (mmnto-ai/totem#2399).
 *
 * The staleness check in `lint.ts` compares one AGGREGATE `input_hash` against
 * the manifest and, on mismatch, warned with a fixed string that named nothing.
 * This module turns that boolean "stale" verdict into a NAMED delta: which
 * lesson files changed / were added / were removed since the last compile, so
 * the consumer can tell whether the drift is theirs, rode in on a merge, or is
 * the mmnto-ai/totem#2113 untracked-at-compile class.
 *
 * Every export here is PURE (no `node:fs`, no `child_process`): the classify
 * and format logic is unit-tested without a real git repo or temp dir (the
 * cohort's standing "no real `git` with cwd=temp on Windows" rule — it leaves
 * undeletable temp dirs). `lint.ts` owns the impure gathering (the `git`
 * name-status diff + `git log` provenance via the shared `safeExec` helper, and
 * the `fs` mtime walk) and feeds the results to these helpers.
 */

// ─── Constants ──────────────────────────────────────

/**
 * Max lesson names printed in the warning before collapsing the tail to
 * "…and K more". Keeps the advisory to a glanceable block and caps the number
 * of per-file `git log` provenance spawns at exactly this many.
 */
export const STALE_LESSON_NAME_CAP = 5;

/**
 * Above this many lesson files, skip per-file provenance (name-only mode).
 * Provenance is already bounded to at most {@link STALE_LESSON_NAME_CAP} `git
 * log` calls, but the whole staleness check is a non-blocking advisory on the
 * lint hot path: on a very large lesson corpus we decline to spawn git per
 * named file at all rather than let the naming logic pace the run.
 */
export const PROVENANCE_LESSON_FILE_CAP = 500;

// ─── Types ──────────────────────────────────────────

export type LessonChangeKind = 'changed' | 'added' | 'removed';

export interface LessonDeltaEntry {
  /**
   * Path of the changed lesson. Repo-root-relative forward-slash form when the
   * delta came from `git diff --name-status`; lessons-dir-relative in the mtime
   * fallback. Callers render a short display name via `path.basename`, so either
   * basis reads correctly.
   */
  path: string;
  kind: LessonChangeKind;
}

export interface LessonDelta {
  /** Classified entries, sorted by path for deterministic output. */
  entries: LessonDeltaEntry[];
}

/** Last-commit provenance for one named lesson. */
export interface LessonProvenance {
  /** Short commit sha of the last commit that touched the file. */
  shortSha: string;
  /** Author name of that commit. */
  author: string;
}

/**
 * Sentinel provenance for a lesson with no commit history — staged-but-never-
 * committed / untracked. This is the mmnto-ai/totem#2113 class and is worth
 * distinguishing from a real commit in the warning.
 */
export const UNTRACKED_PROVENANCE = 'untracked';

export type ProvenanceValue = LessonProvenance | typeof UNTRACKED_PROVENANCE;

export interface FormatStalenessOptions {
  /** Max named lessons before the "…and K more" tail (usually {@link STALE_LESSON_NAME_CAP}). */
  nameCap: number;
  /** Map a delta `path` to the short display name shown in the warning. */
  displayNameFor: (path: string) => string;
  /**
   * Per-path provenance keyed by the delta `path`. `null` disables provenance
   * entirely (name-only mode — git unavailable, or above
   * {@link PROVENANCE_LESSON_FILE_CAP}). When non-null, a path absent from the
   * map simply renders without a provenance suffix.
   */
  provenance: Map<string, ProvenanceValue> | null;
}

// ─── Sort ────────────────────────────────────────────

function sortEntries(entries: LessonDeltaEntry[]): LessonDeltaEntry[] {
  return [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// ─── Git name-status classifier (primary) ───────────

/**
 * Parse `git diff --name-status <anchor>` output into a classified lesson delta,
 * keeping only `.md` files under `lessonsPrefix` (a repo-relative, forward-slash
 * directory prefix such as `.totem/lessons`).
 *
 * Status letters map: `A`/`C` → added, `D` → removed, `M`/`T` → changed. A
 * rename (`R`) reports its DESTINATION path as `changed` (a lesson whose path
 * moved shifts the input hash because `generateInputHash` folds the relative
 * path into the digest). Rename/copy lines carry `OLD<TAB>NEW`, so the current
 * path is the third tab field; A/M/D carry `STATUS<TAB>PATH`. Unknown status
 * letters (`U` unmerged, etc.) are ignored — best-effort naming, never a throw.
 */
export function parseLessonNameStatus(raw: string, lessonsPrefix: string): LessonDelta {
  const prefix = lessonsPrefix.endsWith('/') ? lessonsPrefix : `${lessonsPrefix}/`;
  const entries: LessonDeltaEntry[] = [];

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const fields = line.split('\t');
    const status = fields[0]?.[0];
    if (!status) continue;

    // Rename/copy carry `OLD<TAB>NEW`; the destination is the current path.
    const isRenameOrCopy = status === 'R' || status === 'C';
    const rawTarget = isRenameOrCopy ? fields[2] : fields[1];
    if (!rawTarget) continue;

    const target = rawTarget.replace(/\\/g, '/');
    if (!target.startsWith(prefix) || !target.endsWith('.md')) continue;

    let kind: LessonChangeKind;
    switch (status) {
      case 'A':
      case 'C':
        kind = 'added';
        break;
      case 'D':
        kind = 'removed';
        break;
      case 'M':
      case 'T':
      case 'R':
        kind = 'changed';
        break;
      default:
        continue; // Unknown status (unmerged, etc.) — ignore, don't guess.
    }
    entries.push({ path: target, kind });
  }

  return { entries: sortEntries(entries) };
}

// ─── mtime classifier (fallback) ─────────────────────

export interface LessonFileStat {
  /** Lessons-dir-relative (or any stable) forward-slash path. */
  path: string;
  /** File mtime in epoch-milliseconds. */
  mtimeMs: number;
}

/**
 * Fallback classifier for when git is unavailable (no repo, or the manifest was
 * never committed so there is no anchor): a lesson file whose mtime is strictly
 * after the manifest's compile instant is reported as `changed`.
 *
 * mtime alone cannot recover added-vs-removed-vs-edited (a removed file has no
 * mtime to observe; a freshly-written file is indistinguishable from an edit),
 * so every hit is `changed` — the honest floor when there is no git baseline.
 * A non-finite `compiledAtMs` (unparseable `compiled_at`) yields an empty delta
 * rather than naming every file.
 */
export function classifyLessonsByMtime(
  files: readonly LessonFileStat[],
  compiledAtMs: number,
): LessonDelta {
  if (!Number.isFinite(compiledAtMs)) return { entries: [] };
  const entries: LessonDeltaEntry[] = [];
  for (const file of files) {
    if (file.mtimeMs > compiledAtMs) entries.push({ path: file.path, kind: 'changed' });
  }
  return { entries: sortEntries(entries) };
}

// ─── Warning formatter ───────────────────────────────

const REMEDIATION = "Run 'totem lesson compile' to update.";

/**
 * Build the single warn-block body for a stale manifest. One block, ready to
 * hand to `uiLog.warn(TAG, …)`.
 *
 * - `total === 0` (nothing could be named — git unavailable and no mtime hit,
 *   or an anchor miss): fall back to the generic advisory. The stable
 *   `Compile manifest is stale` prefix is preserved so any consumer matching on
 *   it keeps working, and we never assert "0 lesson(s) changed".
 * - otherwise: a counted first line, up to `nameCap` named lessons with their
 *   change kind and (when derivable) `— <sha> by <author>` provenance or
 *   `(untracked)`, then "…and K more" when over the cap, then the remediation.
 *
 * The remediation intentionally points public consumers at `totem lesson
 * compile`; the cohort-side compile freeze is overlay-governed, not this
 * string's concern.
 */
export function formatStalenessWarning(delta: LessonDelta, opts: FormatStalenessOptions): string {
  const total = delta.entries.length;
  if (total === 0) {
    return `Compile manifest is stale — lessons changed since last compile. ${REMEDIATION}`;
  }

  const lines: string[] = [
    `Compile manifest is stale — ${total} lesson(s) changed since last compile.`,
  ];

  for (const entry of delta.entries.slice(0, opts.nameCap)) {
    const name = opts.displayNameFor(entry.path);
    let suffix = '';
    if (opts.provenance) {
      const prov = opts.provenance.get(entry.path);
      if (prov === UNTRACKED_PROVENANCE) {
        suffix = ' (untracked)';
      } else if (prov) {
        suffix = ` — ${prov.shortSha} by ${prov.author}`;
      }
    }
    lines.push(`  • ${name} (${entry.kind})${suffix}`);
  }

  if (total > opts.nameCap) {
    lines.push(`  …and ${total - opts.nameCap} more.`);
  }

  lines.push(REMEDIATION);
  return lines.join('\n');
}
