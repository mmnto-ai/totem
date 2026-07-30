/**
 * Query-before-derive compliance — the metric (mmnto-ai/totem#2510).
 *
 * ## The number
 *
 * Of the derive-class actions in an agent session (spec synthesis, orientation
 * derivation, review grounding), what fraction was preceded by a corpus query
 * correlated to that action?
 *
 *     compliance = correlated derive events / ALL derive events
 *
 * ## Denominator discipline (#2510 falsifier 1)
 *
 * The denominator is **every** derive-class event in the evaluated sessions,
 * including sessions that fired zero queries. A session that derived without
 * ever querying is the exact behaviour this metric exists to catch, so it must
 * pull the number DOWN, not vanish from it. Two places this could have been
 * gamed, and how each is closed:
 *
 *  - *at the ratio level* — counting only derives that carry an ID. Closed: the
 *    denominator counts derive rows, correlated or not.
 *  - *at the window level* — enumerating only sessions that contain queries.
 *    Closed: session selection keys on "carries ≥1 derive-class event,
 *    regardless of query count", which is the operator-pinned window phrasing.
 *
 * ## Numerator discipline (#2510 falsifier 2)
 *
 * A derive counts as correlated only when its `qbd_correlation_id` resolves to
 * a `corpus_query` row that actually appears earlier in the ledger, in the same
 * session and from the same seat. Ways that check fails, all counted as
 * anomalies and none as compliant: a schema-rejected ID (see
 * `correlation-id.ts`), an ID with no matching query row (orphan — a truncated
 * or tampered ledger), an ID whose query row belongs to a different session or
 * a different seat, and a row whose timestamp regresses in an append-only file
 * (a backdated append trying to seize the evaluation window).
 *
 * One query grounds exactly ONE derive — the pointer is consumed on use (see
 * `record.ts`). Without that, a single query would credit every derive for the
 * rest of the correlation window.
 *
 * ## What this metric CANNOT see (#2510 falsifier 4, ritual query)
 *
 * A query fired purely to satisfy the metric, whose results the following
 * derive never reads, is indistinguishable here from a query that genuinely
 * grounded the derive. Both produce a query row and a correlated derive row.
 * v1 senses adjacency, not influence. This is named, not solved — the honest
 * statement is that the number measures whether querying happened before
 * deriving, NOT whether the derive used what the query returned. Any reading
 * that treats it as the latter is over-claiming.
 *
 * ## Degraded reads (ADR-115 § 2)
 *
 * `readLedgerEvents` skips schema-invalid lines silently, which would let a torn
 * or tampered ledger render as a confident 100% or a confident 0%. This scanner
 * therefore parses the NDJSON itself and counts every rejected line by class. A
 * scan with any integrity anomaly is `degraded`, and the render must announce
 * that rather than print a bare number.
 */

import { LEDGER_EVENT_TYPES, LedgerEventSchema, QBD_EVENT_TYPES } from '../ledger.js';
import { QBD_CORRELATION_WINDOW_MS } from './correlation-id.js';

// ─── Pre-registration (fixed before the sensor first emitted) ───

/** Pre-registered floor. Below this at the checkpoint, the claim is falsified. */
export const QBD_PRE_REGISTERED_THRESHOLD = 0.5;

/** Pre-registered evaluation window, in sessions. */
export const QBD_PRE_REGISTERED_WINDOW_SESSIONS = 20;

/**
 * The pre-registration, verbatim as pinned by the operator ruling 2026-07-28 on
 * mmnto-ai/totem#2510. Rendered verbatim by the doctor section — the exact
 * phrasing is load-bearing: an earlier "first 20 correlated sessions" wording
 * was post-hoc-interpretable as excluding zero-query sessions, which would have
 * enacted falsifier 1 at the window level. Do not paraphrase this string.
 */
export const QBD_PRE_REGISTRATION_STATEMENT =
  'compliance ≥ 0.50, evaluated over the first 20 instrumented sessions carrying ≥1 derive-class event, regardless of query count';

/**
 * Window for the id-less rolling-window session fallback. Same span as the
 * correlation window so the slice carries one time constant rather than two;
 * see `correlation-id.ts` for why that value is this slice's design call and
 * not something ADR-029 § 2 authorises.
 */
const SESSION_ROLLUP_WINDOW_MS = QBD_CORRELATION_WINDOW_MS;

/** Minimum instrumented sessions per side before a trend is worth printing. */
const MIN_SESSIONS_PER_TREND_SIDE = 2;

// ─── Types ──────────────────────────────────────────────

export type QbdEventType = 'corpus_query' | 'derive_action';

/** A QBD row lifted out of the ledger. */
export interface QbdRow {
  ms: number;
  type: QbdEventType;
  activityName?: string;
  sessionId?: string;
  correlationId?: string;
  agentSource?: string;
}

/** Per-item anomaly accounting — every rejected or unjoinable item, by class. */
export interface QbdAnomalies {
  /** Lines that were not valid JSON (a torn append, a hand-edit). */
  malformedJson: number;
  /**
   * Lines that parsed as JSON but were rejected by the ledger schema while
   * looking like QBD rows — this is where a backfilled correlation ID lands.
   */
  correlationContractViolations: number;
  /** Lines rejected by the schema whose event type could not be classified. */
  unclassifiedInvalid: number;
  /** Derive rows whose correlation ID matches no earlier query row. */
  orphanCorrelations: number;
  /** Derive rows whose correlated query row belongs to a different session. */
  crossSessionCorrelations: number;
  /**
   * Derive rows citing a correlation ID an earlier derive already spent. One
   * query grounds one derive; a re-citation means the write-side consume
   * failed, raced, or was bypassed.
   */
  duplicateCorrelations: number;
  /**
   * Uncorrelated derives that had an in-window query from a DIFFERENT seat —
   * the signature of one-sided seat plumbing. A diagnostic hint, never an
   * integrity anomaly, so it does not degrade the read.
   */
  seatMismatchHints: number;
  /**
   * Rows whose timestamp regresses behind the newest already seen in this
   * append-only file — the backdated-append attack on the evaluation window.
   */
  backdatedRows: number;
  /**
   * Rows carrying an event type this build does not know. An ADVISORY, not an
   * integrity anomaly: the ordinary cause is version skew, and it deliberately
   * does NOT flip `degraded`.
   */
  unknownTypeRows: number;
  /** Human-readable detail lines, capped, for the render. */
  details: string[];
}

export interface QbdScanResult {
  rows: QbdRow[];
  /** Non-empty lines examined. */
  linesScanned: number;
  anomalies: QbdAnomalies;
  /**
   * True when any integrity anomaly fired. A degraded scan must never render as
   * a clean number (ADR-115 § 2) — the number it would print is not trustworthy
   * because rows are known to be missing or rejected.
   */
  degraded: boolean;
}

export interface QbdRateStat {
  /** Derive-class events counted (the denominator). */
  derives: number;
  /** Of `derives`, how many were correlated to a preceding query. */
  correlated: number;
}

export type QbdVerdict = 'PENDING' | 'PASS' | 'FAIL';

export interface QbdComplianceReport {
  /** Sessions carrying ≥1 derive-class event, in first-seen order. */
  instrumentedSessions: number;
  /** Sessions actually evaluated (capped at the pre-registered window). */
  evaluatedSessions: number;
  /** The pre-registration window's rate. */
  window: QbdRateStat;
  /** The rate, or null when there is nothing to divide. */
  compliance: number | null;
  /**
   * `PENDING` until the window fills — the pre-registered threshold is not
   * evaluable before then, and calling it early in either direction would be
   * exactly the post-hoc reinterpretation the registration forbids.
   */
  verdict: QbdVerdict;
  /** Trend across all instrumented sessions, earlier half vs recent half. */
  trend: { earlier: QbdRateStat; recent: QbdRateStat } | null;
  anomalies: QbdAnomalies;
  degraded: boolean;
}

// ─── Scan ───────────────────────────────────────────────

/**
 * Event types that exist in the ledger and are not part of this metric.
 *
 * DERIVED from the ledger schema's own type list, never hand-mirrored: a copied
 * list rots the moment a type is added to `ledger.ts`, and here that rot is not
 * cosmetic — an unrecognised type used to flip the whole scan to DEGRADED.
 * `ledger-type-parity` in the tests pins this to the schema.
 */
const NON_QBD_TYPES: ReadonlySet<string> = new Set(
  LEDGER_EVENT_TYPES.filter((t) => !(QBD_EVENT_TYPES as readonly string[]).includes(t)),
);

/**
 * How far a row's timestamp may regress behind the newest timestamp seen so far
 * before the scan calls it backdated.
 *
 * The ledger is append-only, so timestamps should march forward. Small
 * regressions are legitimate — concurrent writers in one repo, sub-second clock
 * jitter, a cohort seat whose clock drifts slightly — so the tolerance is
 * generous. What it catches is the real attack: APPENDING rows stamped far in
 * the past to seize the pre-registered first-20-session window.
 */
const BACKDATE_TOLERANCE_MS = 5 * 60 * 1000;

/** Cap on stored detail strings so a pathological ledger cannot balloon memory. */
const MAX_ANOMALY_DETAILS = 20;

function emptyAnomalies(): QbdAnomalies {
  return {
    malformedJson: 0,
    correlationContractViolations: 0,
    unclassifiedInvalid: 0,
    orphanCorrelations: 0,
    crossSessionCorrelations: 0,
    duplicateCorrelations: 0,
    seatMismatchHints: 0,
    backdatedRows: 0,
    unknownTypeRows: 0,
    details: [],
  };
}

function pushDetail(anomalies: QbdAnomalies, detail: string): void {
  if (anomalies.details.length < MAX_ANOMALY_DETAILS) anomalies.details.push(detail);
}

/**
 * Parse the raw `events.ndjson` contents, lifting out QBD rows and counting
 * every line this metric could not trust.
 *
 * Deliberately does NOT use `readLedgerEvents`: that helper drops schema-invalid
 * lines without telling anyone, which is precisely how a tampered ledger would
 * render as a clean number.
 */
export function scanQbdLedger(content: string): QbdScanResult {
  const rows: QbdRow[] = [];
  const anomalies = emptyAnomalies();
  let linesScanned = 0;
  /** Newest QBD timestamp seen so far, in FILE order — the monotonicity baseline. */
  let maxSeenMs: number | undefined;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.length === 0) continue;
    linesScanned++;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
      // totem-context: a torn or hand-edited NDJSON line is counted (malformedJson) and surfaced in the DEGRADED envelope per ADR-115 § 2 — never silently dropped, and never a crash of the read-only sensor.
    } catch {
      anomalies.malformedJson++;
      pushDetail(anomalies, `line ${i + 1}: not valid JSON`);
      continue;
    }

    const rawObject =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : undefined;
    const rawType = rawObject?.type;

    const result = LedgerEventSchema.safeParse(parsed);
    if (!result.success) {
      // ORDER IS LOAD-BEARING. The QBD-marker test must run BEFORE the
      // "belongs to another subsystem" fast path. A row can carry a forged
      // `qbd_correlation_id` while claiming a non-QBD `type` — and if the
      // fast path ran first, that row would be dropped with zero anomalies
      // and the ledger would render clean. That is exactly the tampering
      // ADR-115 § 2 exists to make impossible to miss, so a qbd-field-bearing
      // schema failure is a contract violation on ANY type.
      const looksQbd =
        rawType === 'corpus_query' ||
        rawType === 'derive_action' ||
        (rawObject !== undefined && 'qbd_correlation_id' in rawObject);
      const reason = result.error.issues.map((issue) => issue.message).join('; ');
      if (looksQbd) {
        anomalies.correlationContractViolations++;
        pushDetail(anomalies, `line ${i + 1}: correlation contract violation — ${reason}`);
        continue;
      }
      if (typeof rawType === 'string' && NON_QBD_TYPES.has(rawType)) {
        // Another subsystem's row failed its OWN schema and carries no QBD
        // markers. Not this metric's integrity problem, not counted against it.
        continue;
      }
      if (typeof rawType === 'string' && rawType.length > 0) {
        // A type this build does not know. The benign cause is version skew —
        // a newer writer in the same repo emitting an event type this binary
        // predates — which is emphatically NOT evidence that the ledger was
        // tampered with. Report it as a named advisory; do NOT flip DEGRADED,
        // or routine skew would drown the signal that real tampering produces.
        anomalies.unknownTypeRows++;
        pushDetail(
          anomalies,
          `line ${i + 1}: unknown event type '${rawType}' (this build predates it — version skew, not tampering)`,
        );
        continue;
      }
      // No usable type at all — this is structural corruption, not skew.
      anomalies.unclassifiedInvalid++;
      pushDetail(anomalies, `line ${i + 1}: unclassifiable invalid row — ${reason}`);
      continue;
    }

    const event = result.data;
    const ms = Date.parse(event.timestamp);

    if (event.type !== 'corpus_query' && event.type !== 'derive_action') {
      // Not our row — but its timestamp still advances the monotonicity
      // reference. This is load-bearing: on a ledger adopted mid-life, the
      // EXISTING non-QBD history is the only baseline a backdated QBD append
      // can be measured against. Referencing QBD rows alone left the check
      // blind in exactly the fresh-adopter state the pre-registered first-20
      // window is filled from — 20 backdated pairs read PASS, degraded=false.
      if (Number.isFinite(ms) && (maxSeenMs === undefined || ms > maxSeenMs)) maxSeenMs = ms;
      continue;
    }

    if (!Number.isFinite(ms)) {
      anomalies.unclassifiedInvalid++;
      pushDetail(anomalies, `line ${i + 1}: QBD row with an unparseable timestamp`);
      continue;
    }

    // Append-only monotonicity. The ledger only ever grows at the end, so a row
    // stamped far behind the newest one already seen was APPENDED with a
    // backdated timestamp. That is the cheap attack on a "first N sessions"
    // window — no whole-file rewrite required, just `>> events.ndjson` with old
    // stamps — so it must degrade the read. The row is still counted (dropping
    // it would shrink the denominator, which is the other failure mode); the
    // scan simply refuses to call the resulting number verified.
    if (maxSeenMs !== undefined && ms < maxSeenMs - BACKDATE_TOLERANCE_MS) {
      anomalies.backdatedRows++;
      pushDetail(
        anomalies,
        `line ${i + 1}: timestamp ${new Date(ms).toISOString()} regresses more than BACKDATE_TOLERANCE_MS (${BACKDATE_TOLERANCE_MS}ms) behind ${new Date(maxSeenMs).toISOString()} in an append-only ledger`,
      );
    }
    if (maxSeenMs === undefined || ms > maxSeenMs) maxSeenMs = ms;

    rows.push({
      ms,
      type: event.type,
      ...(event.activity_name !== undefined && { activityName: event.activity_name }),
      ...(event.session_id !== undefined && { sessionId: event.session_id }),
      ...(event.qbd_correlation_id !== undefined && { correlationId: event.qbd_correlation_id }),
      ...(event.agent_source !== undefined && { agentSource: event.agent_source }),
    });
  }

  rows.sort((a, b) => a.ms - b.ms);

  // `unknownTypeRows` is deliberately absent: version skew is not tampering.
  const degraded =
    anomalies.malformedJson > 0 ||
    anomalies.correlationContractViolations > 0 ||
    anomalies.unclassifiedInvalid > 0 ||
    anomalies.backdatedRows > 0;

  return { rows, linesScanned, anomalies, degraded };
}

// ─── Session grouping ───────────────────────────────────

interface QbdSession {
  key: string;
  firstMs: number;
  rows: QbdRow[];
}

/**
 * Group rows into sessions.
 *
 * Rows carrying a `session_id` group by it. Rows without one (hookless agents,
 * pre-hook runs) fall back to a rolling-window roll-up, applied among
 * themselves and PARTITIONED BY `agent_source`. Both are "instrumented
 * sessions"; neither is privileged.
 *
 * The agent partition matters concretely: cohort seats share one working tree
 * per repo, so two seats writing to the same ledger inside the same two-hour
 * span would otherwise be rolled into a single "session", letting one seat's
 * query sit in the same session as another seat's derive. Sessions are
 * per-agent, so the fallback is too.
 *
 * Note on provenance: preferring an explicit session id over a time heuristic
 * follows the `.session-id` primitive's own documented contract
 * (`session-id.ts`), not ADR-029 § 2 — that section defines a session-GROUPING
 * heuristic for the recall metric, which is a different question.
 */
export function groupQbdSessions(rows: QbdRow[]): QbdSession[] {
  const byId = new Map<string, QbdSession>();
  const idless: QbdRow[] = [];

  for (const row of rows) {
    if (row.sessionId === undefined) {
      idless.push(row);
      continue;
    }
    // Key on the agent too: a session id is only unique within the agent that
    // minted it, and two seats must never share a session bucket.
    const key = `sid:${row.agentSource ?? ''}:${row.sessionId}`;
    const existing = byId.get(key);
    if (existing === undefined) {
      byId.set(key, { key, firstMs: row.ms, rows: [row] });
    } else {
      existing.rows.push(row);
      if (row.ms < existing.firstMs) existing.firstMs = row.ms;
    }
  }

  const sessions = [...byId.values()];

  // Rolling-window fallback for id-less rows, PER AGENT (rows are time-sorted).
  const openByAgent = new Map<string, { session: QbdSession; lastMs: number }>();
  let windowIndex = 0;
  for (const row of idless) {
    const agent = row.agentSource ?? '';
    const open = openByAgent.get(agent);
    if (open === undefined || row.ms - open.lastMs > SESSION_ROLLUP_WINDOW_MS) {
      const session: QbdSession = {
        key: `win:${agent}:${windowIndex++}`,
        firstMs: row.ms,
        rows: [row],
      };
      sessions.push(session);
      openByAgent.set(agent, { session, lastMs: row.ms });
    } else {
      open.session.rows.push(row);
      open.lastMs = row.ms;
    }
  }

  sessions.sort((a, b) => a.firstMs - b.firstMs);
  return sessions;
}

// ─── Compute ────────────────────────────────────────────

/**
 * Decide which derive rows earn credit, across the WHOLE scan at once.
 *
 * Runs globally rather than per-session for two reasons: a correlation ID's
 * query row may live outside the session being scored, and — the important one
 * — **the 1:1 rule has to be enforced against every derive in the file**, not
 * within one session's slice.
 *
 * ## Why the read side re-enforces a write-side rule
 *
 * `record.ts` consumes the pointer so one query grounds one derive. That is a
 * write-time rule with no read-time check, which is the same shape as the
 * tampering the scanner already exists to catch — and it is reachable without
 * any adversary: the documented `clearPointer` failure ("may over-credit until
 * removed"), the non-atomic read-then-clear between concurrent derives, or a
 * duplicated line all produce several derives citing one ID. Before this, three
 * derives on one query read as `compliance 1.00, degraded=false`.
 *
 * So: the FIRST derive (in time order) citing an ID takes the credit, and every
 * later citation of that same ID is a named anomaly that degrades the read. The
 * non-atomic read-then-clear race in `record.ts` is accepted *because* this
 * check catches its result rather than silently inflating the number.
 *
 * Mutates `anomalies` with per-item counts. Returns the set of credited rows.
 */
function creditDerives(
  rows: readonly QbdRow[],
  queryIndex: Map<string, QbdRow[]>,
  anomalies: QbdAnomalies,
): Set<QbdRow> {
  const credited = new Set<QbdRow>();
  /** Correlation IDs already spent. One query grounds one derive. */
  const consumed = new Set<string>();
  // Query rows in time order, for the seat-mismatch diagnostic below.
  const queries = rows.filter((r) => r.type === 'corpus_query');

  // `rows` is time-sorted by the scanner, so "first" is unambiguous.
  for (const row of rows) {
    if (row.type !== 'derive_action') continue;

    if (row.correlationId === undefined) {
      // Seat-plumbing diagnostic (NOT an integrity anomaly). An uncorrelated
      // derive whose in-window candidate query carries a DIFFERENT seat is the
      // signature of one-sided seating — e.g. a seated CLI and an unseated MCP
      // server — which silently drives the number to 0.00 with no other tell.
      // A config smell, not tampering, so it never degrades the read.
      const mismatch = queries.some(
        (q) =>
          q.ms <= row.ms &&
          row.ms - q.ms <= QBD_CORRELATION_WINDOW_MS &&
          q.agentSource !== row.agentSource,
      );
      if (mismatch) anomalies.seatMismatchHints++;
      continue;
    }

    const candidates = queryIndex.get(row.correlationId);
    const grounding = candidates?.find((q) => q.ms <= row.ms);
    if (grounding === undefined) {
      anomalies.orphanCorrelations++;
      pushDetail(
        anomalies,
        `derive at ${new Date(row.ms).toISOString()} cites correlation ID ${row.correlationId} with no preceding query row`,
      );
      continue;
    }
    if (grounding.sessionId !== row.sessionId || grounding.agentSource !== row.agentSource) {
      // Different session OR different seat. Both are the same defect from the
      // metric's side: a query that cannot have grounded this derive.
      anomalies.crossSessionCorrelations++;
      pushDetail(
        anomalies,
        `derive at ${new Date(row.ms).toISOString()} correlates to a query from a different session or seat`,
      );
      continue;
    }
    if (consumed.has(row.correlationId)) {
      anomalies.duplicateCorrelations++;
      pushDetail(
        anomalies,
        `derive at ${new Date(row.ms).toISOString()} re-cites correlation ID ${row.correlationId}, already spent by an earlier derive (one query grounds one derive)`,
      );
      continue;
    }
    consumed.add(row.correlationId);
    credited.add(row);
  }

  return credited;
}

/** Tally one session against the globally-decided credit set. */
function scoreSession(session: QbdSession, credited: ReadonlySet<QbdRow>): QbdRateStat {
  const stat: QbdRateStat = { derives: 0, correlated: 0 };
  for (const row of session.rows) {
    if (row.type !== 'derive_action') continue;
    // Every derive counts, correlated or not (falsifier 1).
    stat.derives++;
    if (credited.has(row)) stat.correlated++;
  }
  return stat;
}

function sumStats(stats: QbdRateStat[]): QbdRateStat {
  return stats.reduce<QbdRateStat>(
    (acc, s) => ({ derives: acc.derives + s.derives, correlated: acc.correlated + s.correlated }),
    { derives: 0, correlated: 0 },
  );
}

/**
 * Compute the compliance report from a scan.
 *
 * The verdict stays `PENDING` until the pre-registered window fills. That is
 * deliberate: declaring PASS at n=3 would be as much a post-hoc reinterpretation
 * of the registration as moving the threshold would be.
 */
export function computeQbdCompliance(scan: QbdScanResult): QbdComplianceReport {
  const anomalies: QbdAnomalies = {
    ...scan.anomalies,
    details: [...scan.anomalies.details],
  };

  const queryIndex = new Map<string, QbdRow[]>();
  for (const row of scan.rows) {
    if (row.type !== 'corpus_query' || row.correlationId === undefined) continue;
    const bucket = queryIndex.get(row.correlationId);
    if (bucket === undefined) queryIndex.set(row.correlationId, [row]);
    else bucket.push(row);
  }

  const sessions = groupQbdSessions(scan.rows);
  const instrumented = sessions.filter((s) => s.rows.some((r) => r.type === 'derive_action'));

  // Credit is decided globally FIRST — the 1:1 rule spans sessions.
  const credited = creditDerives(scan.rows, queryIndex, anomalies);
  const perSession = instrumented.map((s) => scoreSession(s, credited));

  const evaluated = perSession.slice(0, QBD_PRE_REGISTERED_WINDOW_SESSIONS);
  const window = sumStats(evaluated);
  const compliance = window.derives === 0 ? null : window.correlated / window.derives;

  let verdict: QbdVerdict = 'PENDING';
  if (instrumented.length >= QBD_PRE_REGISTERED_WINDOW_SESSIONS && compliance !== null) {
    verdict = compliance >= QBD_PRE_REGISTERED_THRESHOLD ? 'PASS' : 'FAIL';
  }

  // Trend across ALL instrumented sessions, earlier half vs recent half.
  let trend: { earlier: QbdRateStat; recent: QbdRateStat } | null = null;
  if (perSession.length >= MIN_SESSIONS_PER_TREND_SIDE * 2) {
    const mid = Math.floor(perSession.length / 2);
    trend = {
      earlier: sumStats(perSession.slice(0, mid)),
      recent: sumStats(perSession.slice(mid)),
    };
  }

  // `seatMismatchHints` is deliberately absent: one-sided seat plumbing is a
  // config smell, not evidence the ledger cannot be trusted.
  const degraded =
    scan.degraded ||
    anomalies.orphanCorrelations > 0 ||
    anomalies.crossSessionCorrelations > 0 ||
    anomalies.duplicateCorrelations > 0;

  return {
    instrumentedSessions: instrumented.length,
    evaluatedSessions: evaluated.length,
    window,
    compliance,
    verdict,
    trend,
    anomalies,
    degraded,
  };
}

/** Format a rate as a fixed-2 fraction, or `n/a` when there is nothing to divide. */
export function formatQbdRate(stat: QbdRateStat): string {
  if (stat.derives === 0) return 'n/a (0 derive-class events)';
  return `${(stat.correlated / stat.derives).toFixed(2)} (${stat.correlated}/${stat.derives})`;
}
