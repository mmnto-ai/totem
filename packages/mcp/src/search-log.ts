import * as fs from 'node:fs';
import * as path from 'node:path';

import type { AgentSourceProvenance, AttributionConflict } from '@mmnto/totem';
import { senseAgentAttribution } from '@mmnto/totem';

export interface SearchLogEntry {
  timestamp: string;
  query: string;
  typeFilter?: string;
  boundary?: string;
  resultCount: number;
  durationMs: number;
  topScore: number | null;
  /**
   * Best per-hit relevance (vector-leg similarity, 0..1) for this query, or
   * `null` when no hit carried a relevance signal (mmnto-ai/totem#2463).
   * Recorded alongside `topScore` because `topScore` is an RRF rank artifact in
   * hybrid/federated modes — `topRelevance` is the calibratable retrieval-quality
   * signal the pilot floor tuning reads. Optional: absent on pre-#2463 entries.
   */
  topRelevance?: number | null;
  error?: string; // eslint-disable-line id-match -- interface property, not a catch binding
  /**
   * A.3.a schema extension (ADR-029 flight-readiness note; ruled in on
   * mmnto-ai/totem#2362). Env-derived at log time; the ~420 pre-extension
   * entries stay permanently unattributed (no retro-inference — Tenet 20).
   *
   * Agent runtime attribution per ADR-078 § Decision item 2, STRICTLY
   * orthogonal to any emitter/subsystem identifier. Derived from
   * `TOTEM_SELF_AGENT` — the one env-carried agent identity in this cohort
   * (packages/core/src/orchestration-resolver.ts § resolveSelfAgents,
   * highest-precedence layer). `null` (stamped explicitly, never guessed —
   * Tenet 4) when the env var is absent, so the reader can partition legacy +
   * hookless events into an explicit "unattributed" bucket rather than a
   * fabricated seat. The ADR-029 compliance reader renders this field as
   * attribution COVERAGE (per-seat entry counts); per-seat compliance rates
   * wait on a commit-side identity primitive, because commits carry no seat
   * identity to join against (ruled on mmnto-ai/totem#2362).
   */
  agent_source?: string | null;
  /**
   * Provenance of `agent_source` (mmnto-ai/totem#2629, ruled two-value enum):
   * `'env'` iff the row was stamped from `TOTEM_SELF_AGENT`, `'absent'` iff no
   * attribution was stamped (the honest stamped-absence default). Optional for
   * pre-sensor rows; `logSearch` stamps it on every new row.
   */
  agent_source_provenance?: AgentSourceProvenance;
  /**
   * Fail-closed disclosure (#2629): present iff the ambient env seat and the
   * session pointer's minting seat disagreed — `agent_source` is withheld and
   * both candidates are named. The query itself is never refused (Tenet 13).
   */
  attribution_conflict?: AttributionConflict;
  /** Named degradation (#2629): the conflict probe failed; the env stamp stands. */
  attribution_probe_error?: string;
  /** A.3.a: explicit session id passed through from `TOTEM_SESSION_ID` if present, else null (never guessed). Reserved forward primitive for the ADR-078 commit-side session join; deliberately inert in the current repo-wide windowing. */
  session_id?: string | null;
  /** A.3.a: trace-correlation id passed through from `TOTEM_CORRELATION_ID` if present, else null (never guessed). Reserved for the A.3.c end-to-end correlation pass; carried now so the trio lands in one producer touch. */
  correlation_id?: string | null;
}

/**
 * The attribution stamp applied to every `SearchLogEntry` at log time: the
 * A.3.a trio (`string | null` — a present value or an explicit `null`, Tenet 4)
 * plus the #2629 provenance/fail-closed fields. Every key is REQUIRED on this
 * interface — `attribution_conflict` / `attribution_probe_error` carry explicit
 * `undefined` when clean — so the spread-last stamp in `logSearch` displaces
 * any caller-supplied value for every stamped field (absence from the sense is
 * as authoritative as presence; `JSON.stringify` drops the undefined keys from
 * the persisted row).
 */
export interface SearchLogAttribution {
  agent_source: string | null;
  agent_source_provenance: AgentSourceProvenance;
  attribution_conflict: AttributionConflict | undefined;
  attribution_probe_error: string | undefined;
  session_id: string | null;
  correlation_id: string | null;
}

/**
 * Read one env var, trim it, and normalize empty/whitespace-only to `null`.
 * `null` is the explicit "not present" stamp (Tenet 4) — never a guessed value.
 */
function envOrNull(env: NodeJS.ProcessEnv, key: string): string | null {
  const raw = env[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Derive the attribution stamp for one row.
 *
 * - `agent_source` + the #2629 provenance/fail-closed fields: delegated to
 *   core's `senseAgentAttribution` — the one derivation both stamp seams
 *   (this one and the selection-manifest builder) consume. Same env read +
 *   comma parse as `resolveSelfAgents` (the MCP server runs under a single
 *   seat, so the first non-empty entry is that seat), cross-checked against
 *   the session pointer's minting seat when `totemDir` is provided.
 * - `session_id` / `correlation_id`: straight pass-through from
 *   `TOTEM_SESSION_ID` / `TOTEM_CORRELATION_ID`.
 *
 * Any field whose env var is absent or blank is stamped `null`. Env-only calls
 * (no `totemDir`) stay pure — no I/O — the testable-producer property the
 * original trio derivation had; with `totemDir` the conflict probe reads the
 * pointer + `events.ndjson`, per call, never cached (ruled — a cache converts
 * a transient contamination into a whole-session one). The probe can never
 * throw into the stamp path: failures degrade to the env-only stamp with the
 * failure named on `attribution_probe_error`.
 */
export function deriveSearchLogAttribution(
  env: NodeJS.ProcessEnv = process.env,
  totemDir?: string,
): SearchLogAttribution {
  const sense = senseAgentAttribution({ env, totemDir });

  return {
    agent_source: sense.agent_source,
    agent_source_provenance: sense.agent_source_provenance,
    attribution_conflict: sense.attribution_conflict,
    attribution_probe_error: sense.attribution_probe_error,
    session_id: envOrNull(env, 'TOTEM_SESSION_ID'),
    correlation_id: envOrNull(env, 'TOTEM_CORRELATION_ID'),
  };
}

export interface SearchStats {
  totalCalls: number;
  avgDuration: number;
  avgTopScore: number;
}

/** In-memory log of search calls for the current server session. */
const entries: SearchLogEntry[] = [];

/** Resolved path to the JSONL log file, set on first logSearch call. */
let logFilePath: string | undefined;

/**
 * Set the directory where the `.search-log.jsonl` file will be written.
 * Must be called before the first `logSearch` to enable file logging.
 */
export function setLogDir(totemDir: string): void {
  logFilePath = path.join(totemDir, '.search-log.jsonl');
}

/**
 * Record a search call.
 *
 * - Stamps the attribution fields (the A.3.a trio + the #2629 provenance /
 *   fail-closed fields) at log time — one producer touch shared by every call
 *   site. The derived stamp is authoritative: a caller-supplied value for any
 *   stamped field is displaced (see the stamp comment below).
 * - Always appends to the in-memory array.
 * - Best-effort appends a single JSON line to `{totemDir}/.search-log.jsonl`.
 *   File writes are fire-and-forget — failures are silently swallowed because
 *   writing to stdout/stderr would corrupt the MCP stdio transport.
 *
 * Returns the stamped entry so the attribution stamp is observable in tests
 * without touching the filesystem.
 */
export function logSearch(entry: SearchLogEntry): SearchLogEntry {
  // Env stamp LAST: the attribution fields are governance telemetry, so the
  // derived values are authoritative — a caller-supplied (or spread-truthy
  // `undefined`) stamped field must never displace the stamp. The attribution
  // object carries every stamped key explicitly (undefined when clean), so a
  // caller-supplied conflict cannot survive a clean sense either.
  // `totemDir` recovers from the log path per call — when `setLogDir` was
  // never called there is no ledger in reach and the sense runs env-only
  // (provenance still stamped, no conflict probe).
  const totemDir = logFilePath !== undefined ? path.dirname(logFilePath) : undefined;
  const stamped: SearchLogEntry = {
    ...entry,
    ...deriveSearchLogAttribution(process.env, totemDir),
  };
  entries.push(stamped);

  // Best-effort, non-blocking file append
  if (logFilePath) {
    try {
      const line = JSON.stringify(stamped) + '\n';
      // fs.promises.appendFile returns a promise — we intentionally do NOT await it.
      // The .catch() swallows any write error silently (no stdout/stderr writes).
      fs.promises.appendFile(logFilePath, line, 'utf-8').catch(() => {
        // Intentionally empty — must not write to stdout/stderr (MCP stdio transport)
      });
    } catch {
      // Intentionally empty — synchronous errors from JSON.stringify etc.
    }
  }

  return stamped;
}

/**
 * Compute aggregate stats from the in-memory search log.
 */
export function getSearchStats(): SearchStats {
  const totalCalls = entries.length;

  if (totalCalls === 0) {
    return { totalCalls: 0, avgDuration: 0, avgTopScore: 0 };
  }

  const avgDuration = entries.reduce((sum, e) => sum + e.durationMs, 0) / totalCalls;

  const scored = entries.filter((e) => e.topScore !== null);
  const avgTopScore =
    scored.length > 0 ? scored.reduce((sum, e) => sum + e.topScore!, 0) / scored.length : 0;

  return { totalCalls, avgDuration, avgTopScore };
}
