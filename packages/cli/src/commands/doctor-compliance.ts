/**
 * Recall-compliance sensor for `totem doctor --compliance` (ADR-029 minimal
 * slice, mmnto-ai/totem#2362).
 *
 * ADR-029 § 1 "Passive Log Analysis" specifies the telemetry pair by design:
 * `.totem/.search-log.jsonl` (produced by the MCP `search_knowledge` tool) +
 * git commit timestamps — write interception was explicitly rejected as too
 * intrusive. The Compliance Rate (§ 3) is the % of coding sessions in which a
 * `search_knowledge` call preceded the session's first commit.
 *
 * Commit-granularity caveat (§ 1, ruled in on #2362): a search landing between
 * a file write and its commit still counts as compliant. That is inherent to
 * the ADR's chosen design and acceptable for a warning-threshold sensor
 * (Tenet 13) — it is a caveat on the readout, not a rename of the metric.
 *
 * Sensor-not-gate (Tenet 13): this command is a pure readout. It never throws,
 * never sets a non-zero exit code, and is not part of the gating `--strict`
 * suite — it only ever reports.
 *
 * Session model (ADR-029 § 2, verbatim): a coding session is "contiguous
 * `search_knowledge` calls and git commits occurring within a rolling 2-hour
 * window" — ONE merged event stream. An intervening commit extends a session
 * exactly like a search does; search-only clusters with window-attached commits
 * are NOT equivalent and were reworked out (2026-07-15 panel fold, codex
 * architecture lens, verified against the ADR text).
 *
 * Why the rate is repo-wide only (same fold): commits carry no seat identity —
 * SHA + timestamp — so a per-seat Compliance Rate would have to guess which
 * seat's search "owns" a commit, fabricating attribution (Tenet 4).
 * `agent_source` renders as an attribution-coverage diagnostic (entry counts
 * per seat; `unattributed` = the ~420 pre-schema entries + hookless sessions),
 * explicitly not a per-seat rate. The per-seat rate activates when a
 * commit-side identity primitive exists (ADR-078 boundary / commit-stamped
 * session ids). `session_id` is stamped by the producer for that same forward
 * join and is deliberately unused in this windowing — there is nothing
 * commit-side to join it against yet.
 *
 * Known precision limit: a later `git rebase` rewrites commit timestamps, which
 * retroactively shifts the 2-hour windows a past run computed against — so a
 * historical Compliance Rate is only as stable as the commit timestamps it read.
 * This is inherent to the passive-log design (§ 1) and is not corrected here.
 */

const TAG = 'Compliance';

/** ADR-029 § 2 rolling session window. */
const WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Below this many counted sessions in a bucket, a percentage is statistically
 * meaningless — render "insufficient data (n=x)" instead of a rate.
 */
const MIN_SESSIONS_FOR_RATE = 5;

/** How far back to read commit history for the metric (bounded to keep the git read cheap). */
const MAX_COMMITS = 2000;

/** Bucket name for events with no `agent_source` (legacy + hookless). */
const UNATTRIBUTED = 'unattributed';

// ─── Types ──────────────────────────────────────────────

/** A parsed `.search-log.jsonl` entry — only the fields the metric needs. */
export interface ComplianceLogEntry {
  timestamp: string;
  agent_source: string | null;
  session_id: string | null;
}

/**
 * The git-history SEAM: a commit's sha + ISO timestamp. The doctor section
 * supplies this from real git via `readCommitRecords`; tests supply literal
 * arrays (no git spawn, no temp dirs).
 */
export interface CommitRecord {
  sha: string;
  timestamp: string;
}

/** Rate numerator/denominator. */
export interface RateStat {
  /** Counted sessions (coding sessions — windows containing ≥1 commit). */
  n: number;
  /** Of `n`, how many had a search precede the window's first commit. */
  compliant: number;
}

export interface ComplianceReport {
  /** Repo-wide Compliance Rate over merged-stream § 2 windows. */
  overall: RateStat;
  /**
   * Attribution coverage — entry counts per `agent_source` bucket, sorted by
   * name (`unattributed` = null/pre-schema). A diagnostic, NOT compliance:
   * commits carry no seat identity, so per-seat rates are non-identifiable
   * until a commit-side join primitive exists.
   */
  coverage: Array<{ bucket: string; entries: number }>;
  /**
   * Windows that searched but never committed. Not a coding session per
   * ADR-029 § 3, so excluded from the denominator — but surfaced so a
   * search-heavy/commit-light stretch is visible, not hidden.
   */
  searchOnlySessions: number;
  /** Raw count of parsed entries with no `agent_source` (the unattributed backlog). */
  unattributedEntries: number;
}

export interface ParseResult {
  entries: ComplianceLogEntry[];
  /** Lines that were non-empty but failed JSON.parse or timestamp validation. */
  malformedCount: number;
}

// ─── Pure: parse ────────────────────────────────────────

/**
 * Parse the raw `.search-log.jsonl` contents. A malformed/corrupt line (bad
 * JSON, or a missing/unparseable timestamp) is skipped and counted — the
 * command never crashes on a partial write or a hand-edit (Tenet 13 sensor
 * pattern: record + continue).
 */
export function parseSearchLog(content: string): ParseResult {
  const entries: ComplianceLogEntry[] = [];
  let malformedCount = 0;

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
      // totem-context: intentional malformed-line tolerance — a corrupt/partial JSONL line is counted (malformedCount surfaces it in the readout) and skipped; the sensor records + continues (Tenet 13), and crashing the doctor on one torn append would be the real degradation.
    } catch {
      malformedCount++;
      continue;
    }
    if (typeof obj !== 'object' || obj === null) {
      malformedCount++;
      continue;
    }
    const rec = obj as Record<string, unknown>;
    const timestamp = rec.timestamp;
    if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))) {
      malformedCount++;
      continue;
    }
    entries.push({
      timestamp,
      // Absent / non-string / explicit null all normalize to the unattributed bucket.
      agent_source: typeof rec.agent_source === 'string' ? rec.agent_source : null,
      session_id: typeof rec.session_id === 'string' ? rec.session_id : null,
    });
  }

  return { entries, malformedCount };
}

// ─── Pure: compute ──────────────────────────────────────

/** One event on the merged § 2 timeline. */
interface StreamEvent {
  ms: number;
  kind: 'search' | 'commit';
}

/**
 * Compute the Compliance Rate report from parsed log entries + the commit seam.
 *
 * 1. Merge searches + commits into ONE repo-wide event timeline (§ 2 verbatim:
 *    sessions are contiguous searches AND commits in a rolling 2-hour window —
 *    an intervening commit extends a session exactly like a search does).
 * 2. Roll windows: a new session starts when the gap from the previous event
 *    exceeds 2 hours.
 * 3. Score each window containing ≥1 commit: compliant iff its earliest search
 *    precedes its earliest commit (a commit-only window is non-compliant by
 *    construction). Search-only windows are excluded from the denominator (not
 *    coding sessions per § 3) but surfaced.
 * 4. Coverage: entry counts per `agent_source` — a diagnostic, never a rate
 *    (commits carry no seat identity; see the header).
 */
export function computeCompliance(
  entries: ComplianceLogEntry[],
  commits: CommitRecord[],
): ComplianceReport {
  // Coverage diagnostic (per-seat entry counts; null → unattributed).
  const coverageMap = new Map<string, number>();
  let unattributedEntries = 0;
  for (const e of entries) {
    const bucket = e.agent_source ?? UNATTRIBUTED;
    if (e.agent_source === null) unattributedEntries++;
    coverageMap.set(bucket, (coverageMap.get(bucket) ?? 0) + 1);
  }

  // Merged § 2 timeline. Entry timestamps are parse-validated finite; commit
  // timestamps come from the seam and are filtered here.
  const events: StreamEvent[] = entries.map((e) => ({
    ms: Date.parse(e.timestamp),
    kind: 'search' as const,
  }));
  for (const c of commits) {
    const ms = Date.parse(c.timestamp);
    if (Number.isFinite(ms)) events.push({ ms, kind: 'commit' });
  }
  events.sort((a, b) => a.ms - b.ms);

  // Rolling windows + scoring.
  const overall: RateStat = { n: 0, compliant: 0 };
  let searchOnlySessions = 0;
  const scoreWindow = (window: StreamEvent[]): void => {
    if (window.length === 0) return;
    const firstCommit = window.find((ev) => ev.kind === 'commit');
    if (firstCommit === undefined) {
      // Searched, never committed — not a coding session (§ 3).
      searchOnlySessions++;
      return;
    }
    const firstSearch = window.find((ev) => ev.kind === 'search');
    overall.n++;
    // Strictly before: § 3 says "preceded" — an equal-timestamp tie does not
    // demonstrate the search informed the commit, so it does not credit.
    if (firstSearch !== undefined && firstSearch.ms < firstCommit.ms) overall.compliant++;
  };
  let window: StreamEvent[] = [];
  for (const ev of events) {
    if (window.length === 0 || ev.ms - window[window.length - 1]!.ms <= WINDOW_MS) {
      window.push(ev);
    } else {
      scoreWindow(window);
      window = [ev];
    }
  }
  scoreWindow(window);

  const coverage = [...coverageMap.entries()]
    .map(([bucket, count]) => ({ bucket, entries: count }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));

  return { overall, coverage, searchOnlySessions, unattributedEntries };
}

// ─── Pure: render helper ────────────────────────────────

/**
 * Format a rate for display. Below `MIN_SESSIONS_FOR_RATE` counted sessions
 * (including n=0), a percentage is meaningless — render the honest
 * "insufficient data (n=x)" instead (ruled in on #2362: keep the metric name
 * "Compliance Rate", surface low-n honestly rather than an over-precise %).
 */
export function formatRate(stat: RateStat): string {
  if (stat.n < MIN_SESSIONS_FOR_RATE) return `insufficient data (n=${stat.n})`;
  const pct = ((stat.compliant / stat.n) * 100).toFixed(0);
  return `${pct}% (n=${stat.n})`;
}

// ─── Git supplier (impure — the seam's production source) ───

/**
 * Read recent commits as `(sha, timestamp)[]` for the metric. Best-effort:
 * any git failure (no repo, no commits, git absent) degrades to an empty array
 * so the sensor renders "insufficient data" rather than crashing. `%cI` is the
 * committer date in strict ISO-8601 — the same instant the compliance windows
 * compare against.
 */
async function readCommitRecords(cwd: string): Promise<CommitRecord[]> {
  const { safeExec } = await import('@mmnto/totem');
  try {
    const out = safeExec('git', ['log', `--max-count=${MAX_COMMITS}`, '--format=%H %cI'], {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    const records: CommitRecord[] = [];
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const sp = trimmed.indexOf(' ');
      if (sp === -1) continue;
      records.push({ sha: trimmed.slice(0, sp), timestamp: trimmed.slice(sp + 1).trim() });
    }
    return records;
    // totem-context: best-effort git read — an empty array is the documented "no history / git unavailable" surface for this sensor (Tenet 13), never a crash of the doctor pipeline.
  } catch {
    return [];
  }
}

// ─── CLI entry ──────────────────────────────────────────

export interface ComplianceCliOptions {
  /** Test seam — production callers omit and the command uses `process.cwd()`. */
  cwdForTest?: string;
  /** Test seam — inject raw log contents instead of reading `.search-log.jsonl`. */
  logContentForTest?: string;
  /** Test seam — inject commits instead of spawning git. */
  commitsForTest?: CommitRecord[];
}

/**
 * CLI entry — renders the Compliance Rate readout. Pure sensor: never throws
 * for a compliance verdict, never sets a non-zero exit code (Tenet 13). Absent
 * log file → the doctor `skip` idiom pointing at the MCP wiring, NOT a fail and
 * NOT 0%.
 */
export async function doctorComplianceCliCommand(
  options: ComplianceCliOptions = {},
): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { sanitizeForTerminal } = await import('@mmnto/totem');
  const { bold, log } = await import('../ui.js');

  const cwd = options.cwdForTest ?? process.cwd();

  // Resolve the totemDir from config best-effort; default to `.totem` (mirrors
  // the other doctor checks, which never hard-fail on a config-less repo).
  let totemDir = '.totem';
  try {
    const { loadConfig, resolveConfigPath } = await import('../utils.js');
    const config = await loadConfig(resolveConfigPath(cwd));
    totemDir = config.totemDir;
    // totem-context: a missing/corrupt config is the honest-absent path (default `.totem`), not a sensor failure — the doctor runs against config-less repos by design.
  } catch (err) {
    if (err instanceof Error && err.message.length === 0) throw err;
  }

  const logPath = path.join(cwd, totemDir, '.search-log.jsonl');
  // totemDir is repo-controlled config — sanitize before it reaches a terminal.
  const displayLogPath = sanitizeForTerminal(path.join(totemDir, '.search-log.jsonl'));

  let content: string;
  if (options.logContentForTest !== undefined) {
    content = options.logContentForTest;
  } else if (!fs.existsSync(logPath)) {
    // Absent log file → skip idiom (NOT a fail, NOT 0%). Point at the producer.
    log.dim(
      TAG,
      `SKIP — no ${displayLogPath} found. The log is produced by the MCP search_knowledge tool; wire the MCP server (.mcp.json) and run some search_knowledge calls, then re-run totem doctor --compliance.`,
    );
    return;
  } else {
    try {
      content = fs.readFileSync(logPath, 'utf-8');
      // totem-context: an unreadable search-log is the honest-absent path for this cosmetic sensor — degrade to the skip idiom, never crash the doctor pipeline.
    } catch {
      log.dim(TAG, `SKIP — ${displayLogPath} present but unreadable.`);
      return;
    }
  }

  const { entries, malformedCount } = parseSearchLog(content);
  const commits = options.commitsForTest ?? (await readCommitRecords(cwd));
  const report = computeCompliance(entries, commits);

  // ── Render ──
  log.info(TAG, bold('Compliance Rate'));
  log.info(TAG, `repo-wide: ${formatRate(report.overall)}`);

  // Caveat line (ruled in on #2362) — a caveat, never a rename.
  log.dim(TAG, 'commit-granularity per ADR-029 § 1');

  // Coverage is a diagnostic, never a per-seat rate: commits carry no seat
  // identity, so a seat-partitioned Compliance Rate would fabricate commit
  // ownership (2026-07-15 panel fold; see the header).
  if (report.coverage.length > 0) {
    log.dim(TAG, 'search attribution coverage (diagnostic — not compliance):');
    for (const { bucket, entries } of report.coverage) {
      const legacyNote = bucket === UNATTRIBUTED ? ' (legacy / hookless — no agent_source)' : '';
      log.dim(
        TAG,
        `  ${sanitizeForTerminal(bucket)}: ${entries} entr${entries === 1 ? 'y' : 'ies'}${legacyNote}`,
      );
    }
  }
  if (report.searchOnlySessions > 0) {
    log.dim(
      TAG,
      `${report.searchOnlySessions} search-only session(s) excluded (searched, no commit — not a coding session)`,
    );
  }
  if (malformedCount > 0) {
    log.warn(TAG, `${malformedCount} malformed log line(s) skipped`);
  }
}
