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
 * Concurrency (ADR-029 § 2 was written single-seat): this cohort runs
 * concurrent multi-seat sessions per repo, so the reader partitions the event
 * stream by `agent_source` BEFORE the rolling-2h clustering runs. Without that,
 * interleaved seats would merge into one pseudo-session, corrupting numerator
 * and denominator both. Entries with no `agent_source` (all ~420 pre-schema
 * entries, plus any hookless session) land in an explicit "unattributed"
 * bucket, surfaced with its count — never fabricated into a seat (Tenet 4/20).
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

/** Per-bucket (or overall) rate numerator/denominator. */
export interface RateStat {
  /** Counted sessions (coding sessions — those with an associated commit). */
  n: number;
  /** Of `n`, how many had a search precede the first commit. */
  compliant: number;
}

export interface ComplianceReport {
  overall: RateStat;
  /** Per-bucket stats, sorted by bucket name; includes `unattributed` when present. */
  buckets: Array<{ bucket: string; stat: RateStat }>;
  /**
   * Sessions that searched but never committed (no associated commit). Not a
   * coding session per ADR-029 § 3, so excluded from every denominator — but
   * surfaced so a search-heavy/commit-light window is visible, not hidden.
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

// ─── Pure: session model ────────────────────────────────

interface Session {
  bucket: string;
  /** Sorted ascending. Empty for a commit-only session. */
  searchMs: number[];
  start: number;
  end: number;
  /** Commit epoch-ms claimed by this session (sorted ascending). */
  commitMs: number[];
}

/**
 * Cluster a sorted list of epoch-ms into rolling-window groups: a new group
 * starts whenever the gap from the previous timestamp exceeds `WINDOW_MS`
 * (ADR-029 § 2).
 */
function rollingClusters(sortedMs: number[]): number[][] {
  const clusters: number[][] = [];
  let current: number[] = [];
  for (const ms of sortedMs) {
    if (current.length === 0 || ms - current[current.length - 1]! <= WINDOW_MS) {
      current.push(ms);
    } else {
      clusters.push(current);
      current = [ms];
    }
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

/**
 * Build the search-anchored sessions for one partition's entries. An explicit
 * `session_id` groups its entries directly (overriding the time heuristic — an
 * agent that provides a persistent id gets exact session boundaries per
 * ADR-029 § 2); entries without one fall through to rolling-2h clustering.
 */
function buildSearchSessions(bucket: string, entries: ComplianceLogEntry[]): Session[] {
  const sessions: Session[] = [];

  // Override path: one session per distinct session_id, regardless of time gaps.
  const byId = new Map<string, number[]>();
  const unkeyed: number[] = [];
  for (const e of entries) {
    const ms = Date.parse(e.timestamp);
    if (e.session_id !== null) {
      const list = byId.get(e.session_id) ?? [];
      list.push(ms);
      byId.set(e.session_id, list);
    } else {
      unkeyed.push(ms);
    }
  }
  for (const list of byId.values()) {
    list.sort((a, b) => a - b);
    sessions.push({
      bucket,
      searchMs: list,
      start: list[0]!,
      end: list[list.length - 1]!,
      commitMs: [],
    });
  }

  // Clustering path: rolling-2h over the id-less entries.
  unkeyed.sort((a, b) => a - b);
  for (const cluster of rollingClusters(unkeyed)) {
    sessions.push({
      bucket,
      searchMs: cluster,
      start: cluster[0]!,
      end: cluster[cluster.length - 1]!,
      commitMs: [],
    });
  }

  return sessions;
}

// ─── Pure: compute ──────────────────────────────────────

/**
 * Compute the Compliance Rate report from parsed log entries + the commit seam.
 *
 * 1. Partition entries by `agent_source` (null → `unattributed`).
 * 2. Per partition, build sessions (session_id override, else rolling-2h).
 * 3. Assign each commit to the earliest-starting session whose window
 *    `[start-2h, end+2h]` contains it (commits carry no `agent_source`, so they
 *    attach to a seat's session by time-proximity). A commit is claimed once.
 * 4. Unclaimed commits (committed with no nearby search) cluster into
 *    commit-only sessions in the `unattributed` bucket — each non-compliant.
 * 5. A search session with ≥1 commit is compliant iff its earliest search
 *    precedes its earliest commit; a session with no commit is search-only
 *    (excluded from the rate). Commit-only sessions are counted, non-compliant.
 */
export function computeCompliance(
  entries: ComplianceLogEntry[],
  commits: CommitRecord[],
): ComplianceReport {
  // 1. Partition.
  const partitions = new Map<string, ComplianceLogEntry[]>();
  let unattributedEntries = 0;
  for (const e of entries) {
    const bucket = e.agent_source ?? UNATTRIBUTED;
    if (e.agent_source === null) unattributedEntries++;
    const list = partitions.get(bucket) ?? [];
    list.push(e);
    partitions.set(bucket, list);
  }

  // 2. Build search sessions across all partitions.
  const sessions: Session[] = [];
  for (const [bucket, list] of partitions) {
    sessions.push(...buildSearchSessions(bucket, list));
  }
  // Deterministic assignment: earliest-starting session claims a commit first.
  sessions.sort((a, b) => a.start - b.start);

  // 3. Assign commits to sessions.
  const commitMsList = commits
    .map((c) => Date.parse(c.timestamp))
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);
  const unclaimed: number[] = [];
  for (const cm of commitMsList) {
    const owner = sessions.find((s) => cm >= s.start - WINDOW_MS && cm <= s.end + WINDOW_MS);
    if (owner) owner.commitMs.push(cm);
    else unclaimed.push(cm);
  }

  // 4. Commit-only sessions (unattributed) from unclaimed commits.
  for (const cluster of rollingClusters(unclaimed)) {
    sessions.push({
      bucket: UNATTRIBUTED,
      searchMs: [],
      start: cluster[0]!,
      end: cluster[cluster.length - 1]!,
      commitMs: cluster,
    });
  }

  // 5. Score.
  const bucketStats = new Map<string, RateStat>();
  let searchOnlySessions = 0;
  const bump = (bucket: string, compliant: boolean): void => {
    const stat = bucketStats.get(bucket) ?? { n: 0, compliant: 0 };
    stat.n++;
    if (compliant) stat.compliant++;
    bucketStats.set(bucket, stat);
  };

  for (const s of sessions) {
    if (s.commitMs.length === 0) {
      // Search-only: searched but never committed → not a coding session.
      searchOnlySessions++;
      continue;
    }
    if (s.searchMs.length === 0) {
      // Commit-only: committed with no preceding search → non-compliant.
      bump(s.bucket, false);
      continue;
    }
    const firstSearch = s.searchMs[0]!;
    const firstCommit = s.commitMs[0]!; // commitMs pushed in ascending commit order
    bump(s.bucket, firstSearch <= firstCommit);
  }

  const buckets = [...bucketStats.entries()]
    .map(([bucket, stat]) => ({ bucket, stat }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));

  const overall = buckets.reduce<RateStat>(
    (acc, b) => ({ n: acc.n + b.stat.n, compliant: acc.compliant + b.stat.compliant }),
    { n: 0, compliant: 0 },
  );

  return { overall, buckets, searchOnlySessions, unattributedEntries };
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

  let content: string;
  if (options.logContentForTest !== undefined) {
    content = options.logContentForTest;
  } else if (!fs.existsSync(logPath)) {
    // Absent log file → skip idiom (NOT a fail, NOT 0%). Point at the producer.
    log.dim(
      TAG,
      `SKIP — no ${path.join(totemDir, '.search-log.jsonl')} found. The log is produced by the MCP search_knowledge tool; wire the MCP server (.mcp.json) and run some search_knowledge calls, then re-run totem doctor --compliance.`,
    );
    return;
  } else {
    try {
      content = fs.readFileSync(logPath, 'utf-8');
      // totem-context: an unreadable search-log is the honest-absent path for this cosmetic sensor — degrade to the skip idiom, never crash the doctor pipeline.
    } catch {
      log.dim(TAG, `SKIP — ${path.join(totemDir, '.search-log.jsonl')} present but unreadable.`);
      return;
    }
  }

  const { entries, malformedCount } = parseSearchLog(content);
  const commits = options.commitsForTest ?? (await readCommitRecords(cwd));
  const report = computeCompliance(entries, commits);

  // ── Render ──
  log.info(TAG, bold('Compliance Rate'));
  log.info(TAG, `overall: ${formatRate(report.overall)}`);

  for (const { bucket, stat } of report.buckets) {
    log.info(TAG, `  seat ${sanitizeForTerminal(bucket)}: ${formatRate(stat)}`);
  }

  // Caveat line (ruled in on #2362) — a caveat, never a rename.
  log.dim(TAG, 'commit-granularity per ADR-029 § 1');

  if (report.unattributedEntries > 0) {
    log.dim(
      TAG,
      `${report.unattributedEntries} entr${report.unattributedEntries === 1 ? 'y' : 'ies'} unattributed (legacy / hookless — no agent_source)`,
    );
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
