import * as fs from 'node:fs';
import * as path from 'node:path';

export interface SearchLogEntry {
  timestamp: string;
  query: string;
  typeFilter?: string;
  boundary?: string;
  resultCount: number;
  durationMs: number;
  topScore: number | null;
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
  /** A.3.a: explicit session id passed through from `TOTEM_SESSION_ID` if present, else null (never guessed). Reserved forward primitive for the ADR-078 commit-side session join; deliberately inert in the current repo-wide windowing. */
  session_id?: string | null;
  /** A.3.a: trace-correlation id passed through from `TOTEM_CORRELATION_ID` if present, else null (never guessed). Reserved for the A.3.c end-to-end correlation pass; carried now so the trio lands in one producer touch. */
  correlation_id?: string | null;
}

/**
 * The A.3.a attribution trio stamped onto every `SearchLogEntry` at log time.
 * Every field is `string | null` — a present value or an explicit `null`
 * (Tenet 4: absence is stamped, never guessed).
 */
export interface SearchLogAttribution {
  agent_source: string | null;
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
 * Derive the A.3.a attribution trio from the environment (default
 * `process.env`). Pure — no I/O, no side effects — so the producer stamp is
 * testable without touching the filesystem.
 *
 * - `agent_source`: from `TOTEM_SELF_AGENT`, reusing the same read + comma
 *   parsing precedent as `resolveSelfAgents` (orchestration-resolver.ts). The
 *   MCP server is spawned under a single seat, so the first non-empty
 *   comma-separated entry is that seat; a bare value passes through unchanged.
 * - `session_id` / `correlation_id`: straight pass-through from
 *   `TOTEM_SESSION_ID` / `TOTEM_CORRELATION_ID`.
 *
 * Any field whose env var is absent or blank is stamped `null`.
 */
export function deriveSearchLogAttribution(
  env: NodeJS.ProcessEnv = process.env,
): SearchLogAttribution {
  const selfAgentRaw = envOrNull(env, 'TOTEM_SELF_AGENT');
  const agent_source =
    selfAgentRaw !== null
      ? // Same comma-split as resolveSelfAgents; take the first non-empty seat.
        (selfAgentRaw
          .split(',')
          .map((s) => s.trim())
          .find((s) => s.length > 0) ?? null)
      : null;

  return {
    agent_source,
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
 * - Stamps the A.3.a attribution trio (`agent_source` / `session_id` /
 *   `correlation_id`) from the environment at log time — one producer touch
 *   shared by every call site. A caller-supplied value (none today) wins over
 *   the env derivation.
 * - Always appends to the in-memory array.
 * - Best-effort appends a single JSON line to `{totemDir}/.search-log.jsonl`.
 *   File writes are fire-and-forget — failures are silently swallowed because
 *   writing to stdout/stderr would corrupt the MCP stdio transport.
 *
 * Returns the stamped entry so the attribution stamp is observable in tests
 * without touching the filesystem.
 */
export function logSearch(entry: SearchLogEntry): SearchLogEntry {
  // Env stamp LAST: the attribution trio is governance telemetry, so the
  // environment-derived values are authoritative — a caller-supplied (or
  // spread-truthy `undefined`) trio field must never displace the stamp.
  const stamped: SearchLogEntry = { ...entry, ...deriveSearchLogAttribution() };
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
