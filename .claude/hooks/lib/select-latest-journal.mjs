// [totem] bespoke helper for .claude/hooks/session-context.mjs — the latest-journal
// pick (mmnto-ai/totem#2828). Pure: takes the journal directory's entries and a
// stat function, returns the pick and its evidence; the hook renders the banner
// line and the selection-manifest reasons from it, so the algorithm is testable
// without spawning the hook.
//
// Policy. The signoff skill's `<model>-NNNN-<slug>.md` counter is what makes a
// lexical sort the recency policy. A seat whose names leave the counter (an HHMM
// clock prefix — seen 2026-09-06/07) breaks that premise silently, so the lexical
// pick is checked against the newest WRITE: these files are per-clone and
// untracked, so mtime is the write instant (the clone/worktree reset that makes
// mtime unsafe for mail cutoffs, mmnto-ai/totem-strategy#813, never reaches an
// untracked directory). When the two disagree the newer write is served and the
// drift is reported. Ties keep the lexical pick.
//
// Resilience. A candidate whose stat fails (a dangling symlink, a file removed
// between readdir and stat, a permission error) is skipped for the mtime
// comparison and reported by name — one unreadable sibling must never drop the
// whole journal context (bot round 1 on mmnto-ai/totem#2831). When the lexical
// pick itself cannot be stat'ed the newest READABLE write is served and the
// reason says so; that is not naming drift. When nothing can be stat'ed the
// lexical pick stands and the hook's own read of it decides.
//
// @param {string[]} entries directory entries (any extension; `.md` is filtered here)
// @param {(file: string) => number} statMtimeMs returns mtimeMs for a basename; may throw
// @returns {null | {
//   files: string[]; lexicalLatest: string; mtimeLatest: string; latest: string;
//   drift: boolean; reason: 'lexical' | 'newest-write' | 'lexical-unreadable';
//   statFailures: Array<{ file: string; message: string }>;
// }}
export function selectLatestJournal(entries, statMtimeMs) {
  const files = [...entries].filter((f) => f.endsWith('.md')).sort().reverse();
  if (files.length === 0) return null;
  const lexicalLatest = files[0];
  let mtimeLatest = null;
  let newestMtimeMs = -Infinity;
  const statFailures = [];
  for (const file of files) {
    let mtimeMs;
    try {
      mtimeMs = statMtimeMs(file);
    } catch (err) {
      statFailures.push({ file, message: err && err.message ? err.message : String(err) });
      continue;
    }
    if (typeof mtimeMs === 'number' && Number.isFinite(mtimeMs) && mtimeMs > newestMtimeMs) {
      newestMtimeMs = mtimeMs;
      mtimeLatest = file;
    }
  }
  const lexicalUnreadable = statFailures.some((s) => s.file === lexicalLatest);
  if (mtimeLatest === null) {
    // Nothing could be stat'ed: the lexical pick stands, the failures are reported.
    return {
      files,
      lexicalLatest,
      mtimeLatest: lexicalLatest,
      latest: lexicalLatest,
      drift: false,
      reason: 'lexical',
      statFailures,
    };
  }
  if (lexicalUnreadable) {
    return {
      files,
      lexicalLatest,
      mtimeLatest,
      latest: mtimeLatest,
      drift: false,
      reason: 'lexical-unreadable',
      statFailures,
    };
  }
  const drift = mtimeLatest !== lexicalLatest;
  return {
    files,
    lexicalLatest,
    mtimeLatest,
    latest: drift ? mtimeLatest : lexicalLatest,
    drift,
    reason: drift ? 'newest-write' : 'lexical',
    statFailures,
  };
}
