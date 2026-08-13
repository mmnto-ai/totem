/**
 * Agent-attribution provenance sense (mmnto-ai/totem#2629).
 *
 * On a shared multi-seat machine, a seat session that mints no identity of its
 * own can inherit ANOTHER seat's attribution through two ambient channels:
 * a wider-than-launch-shell `TOTEM_SELF_AGENT` (user/machine scope) and the
 * shared `.totem/ledger/.session-id` pointer. A wrong-seat row corrupts two
 * denominators; an unattributed row only under-counts — so the ruled posture
 * (operator, 2026-08-12, on the issue) is:
 *
 * - **Provenance on every row, not only on mismatch:** `agent_source_provenance`
 *   is the two-value `'env' | 'absent'` enum — `'env'` iff `agent_source` was
 *   stamped from `TOTEM_SELF_AGENT`, `'absent'` iff no attribution was stamped
 *   (the honest stamped-absence default, Tenet 4).
 * - **Fail-closed at the stamp seam:** when the ambient env seat and the
 *   session pointer's minting seat disagree, stamp NEITHER — no `agent_source`,
 *   plus a conflict disclosure naming both candidates. Fail-closed scopes to
 *   the *attribution*, never the *operation*: the sense never throws into its
 *   caller, so the query/write it decorates is never refused (Tenet 13).
 * - **Never remembered:** identity derives from process env + on-disk state at
 *   call time, per call. No cache at any scope — a session-lifetime cache
 *   converts a transient contamination into a whole-session one (the
 *   `b8d7aa9b` specimen shape).
 *
 * The minting seat is derived from the pointer session's `session_start` row
 * in `events.ndjson` — written by the SessionStart hook's mint block at the
 * #2625 template, so the lookup needs no new producer. Absence of that row
 * (pre-hook ledger, rotated file, unseated mint) is NOT a disagreement: only
 * positive counter-evidence strips attribution.
 *
 * NAMED LIMIT (stated so coverage is never overread): the conflict arm fires
 * only when two PRESENT candidates disagree — a seated process joining a
 * foreign seat's pointer session. The b8d7aa9b specimen itself had an
 * UNSEATED mint row (its minting process's env carried no var), and a
 * machine-wide ambient var makes every mint agree with every process env —
 * both shapes yield an env stamp with no conflict here: the ruling's
 * fail-closed clause covers disagreement between two PRESENT candidates, and
 * the missing-counter-evidence rule (design invariant 3) covers the rest. The
 * sensors for the ambient-scope class are the provenance field (post-hoc
 * partitioning), doctor arm (d)'s registry scope-sense, and the launch-shell
 * scope protocol — not this predicate.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { TotemError } from './errors.js';
import { resolveQbdAgentSource } from './qbd/record.js';
import { readSessionId } from './session-id.js';

const LEDGER_DIR = 'ledger';
const EVENTS_FILE = 'events.ndjson';

/**
 * Errnos that mean "there is no ledger here" rather than "something surprising
 * happened" — the `session-id.ts` absence semantics, minus the permission
 * classes: an EACCES/EPERM/EROFS events file is a real probe failure that must
 * land on the accounting channel, not read as a clean not-instrumented state.
 */
const LEDGER_ABSENT_ERRNOS = new Set(['ENOENT', 'ENOTDIR']);

/** The ruled two-value provenance enum — `'env' | 'absent'`, nothing else. */
export const AGENT_SOURCE_PROVENANCE_VALUES = ['env', 'absent'] as const;
export type AgentSourceProvenance = (typeof AGENT_SOURCE_PROVENANCE_VALUES)[number];

/**
 * The fail-closed disclosure: both candidates named, so a post-hoc reader can
 * partition contaminated windows without guessing which seat was real.
 */
export interface AttributionConflict {
  /** What ambient `TOTEM_SELF_AGENT` claimed (first non-empty comma entry). */
  env_seat: string;
  /** What the pointer session's `session_start` row recorded at mint time. */
  minting_seat: string;
  /** The `.session-id` pointer value the two candidates disagree about. */
  pointer_session_id: string;
}

/** The per-call sense result both stamp seams consume. */
export interface AgentAttributionSense {
  /** Seat to stamp, or `null` — never a guessed value (Tenet 4). */
  agent_source: string | null;
  /** `'env'` iff `agent_source` is non-null — writer-guaranteed biconditional. */
  agent_source_provenance: AgentSourceProvenance;
  /** Present iff the fail-closed rule fired (env seat ≠ minting seat). */
  attribution_conflict?: AttributionConflict;
  /**
   * Present iff the conflict probe failed for a non-benign reason (EACCES-class
   * read failure, torn pointer read throw). The env stamp stands — a broken
   * probe is not counter-evidence — but the degradation names itself on the
   * row rather than vanishing (Tenet 4).
   */
  attribution_probe_error?: string;
}

/** Discriminated lookup result — `found: false` is a normal state, not an error. */
export type SessionMintingSeatLookup = { found: true; seat: string | null } | { found: false };

/**
 * Derive the minting seat of a session from its `session_start` row in
 * `<totemDir>/ledger/events.ndjson`.
 *
 * Scans BACKWARDS (newest row wins) with a cheap substring prefilter before
 * any `JSON.parse`, so the common case — an active session whose mint row is
 * near the tail — costs a file read plus a short scan. Malformed/torn lines
 * are skipped per line (the `parseSearchLog` tolerance precedent): a torn
 * `session_start` reads as not-found, never as a fabricated conflict.
 *
 * Absent events file (ENOENT class) returns `found: false` — the honest
 * not-instrumented state. Every other read errno throws a `TotemError` so the
 * caller can name the probe failure instead of silently degrading.
 */
export function readSessionMintingSeat(
  totemDir: string,
  sessionId: string,
): SessionMintingSeatLookup {
  const eventsPath = path.join(totemDir, LEDGER_DIR, EVENTS_FILE);
  let content: string;
  try {
    content = fs.readFileSync(eventsPath, 'utf-8');
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null ? (err as NodeJS.ErrnoException).code : undefined;
    if (code !== undefined && LEDGER_ABSENT_ERRNOS.has(code)) {
      return { found: false };
    }
    throw new TotemError(
      'ATTRIBUTION_SENSE_LEDGER_READ_FAILED',
      'Unexpected error reading events.ndjson for the minting-seat lookup',
      'Check filesystem permissions for the .totem/ledger/events.ndjson file.',
      err,
    );
  }

  const lines = content.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    // Substring prefilter: a JSON row with type "session_start" and this
    // session id must contain both literals. Skips JSON.parse on the ~all
    // non-matching rows of a large ledger.
    if (!line.includes('"session_start"') || !line.includes(sessionId)) continue;
    let obj: unknown;
    // totem-context: intentional malformed-line tolerance — a torn/corrupt NDJSON line is skipped and the scan continues (the parseSearchLog precedent); a torn mint row must read as not-found, never crash the stamp path or fabricate a conflict.
    try {
      obj = JSON.parse(line);
      // totem-context: intentional degradation — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch {
      continue;
    }
    if (typeof obj !== 'object' || obj === null) continue;
    const rec = obj as Record<string, unknown>;
    if (rec.type !== 'session_start' || rec.session_id !== sessionId) continue;
    const seat =
      typeof rec.agent_source === 'string' && rec.agent_source.trim().length > 0
        ? rec.agent_source.trim()
        : null;
    return { found: true, seat };
  }
  return { found: false };
}

export interface AgentAttributionSenseInput {
  /**
   * Resolved `.totem` directory. Omit to run env-only (no conflict probe) —
   * the honest shape for callers with no ledger in reach; provenance is still
   * disclosed.
   */
  totemDir?: string;
  /** Test seam — production callers omit and the sense reads `process.env`. */
  env?: NodeJS.ProcessEnv;
  /**
   * The pointer session id the caller already resolved for the row it is
   * stamping (the manifest builder's shape — one pointer read per row, so the
   * probe cannot race a concurrent rotation into checking a DIFFERENT session
   * than the row joins). Omit and the probe reads the pointer itself.
   */
  pointerSessionId?: string;
}

/**
 * Derive the agent-attribution stamp for one row. Per call, never cached —
 * see the module contract. Never throws: every probe failure degrades to the
 * env-only stamp with the failure named on `attribution_probe_error`.
 */
export function senseAgentAttribution(
  input: AgentAttributionSenseInput = {},
): AgentAttributionSense {
  const env = input.env ?? process.env;
  const envSeat = resolveQbdAgentSource(env) ?? null;

  // No env identity → stamped absence. The pointer's minting seat is never
  // promoted into agent_source here: one candidate is not a conflict, and
  // stamping a seat the process did not declare would be a guess (Tenet 4).
  if (envSeat === null) {
    return { agent_source: null, agent_source_provenance: 'absent' };
  }

  if (input.totemDir === undefined) {
    return { agent_source: envSeat, agent_source_provenance: 'env' };
  }

  let probeError: string | undefined;
  // totem-context: intentional degradation — a failed conflict probe keeps the env stamp (a broken probe is not counter-evidence) and names itself on attribution_probe_error; throwing here would let telemetry break the tool call it decorates (Tenet 13, lesson-b1bae311).
  try {
    const pointerId = input.pointerSessionId ?? readSessionId(input.totemDir);
    if (pointerId !== undefined) {
      const minting = readSessionMintingSeat(input.totemDir, pointerId);
      if (minting.found && minting.seat !== null && minting.seat !== envSeat) {
        // Fail-closed: two candidates disagree — stamp neither, name both.
        return {
          agent_source: null,
          agent_source_provenance: 'absent',
          attribution_conflict: {
            env_seat: envSeat,
            minting_seat: minting.seat,
            pointer_session_id: pointerId,
          },
        };
      }
    }
    // totem-context: intentional degradation — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
  } catch (err) {
    // One level of cause unrolled: the wrapper text names the probe step, the
    // cause names the errno — the half a post-hoc reader actually filters on.
    const causeMsg =
      err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : '';
    probeError = `${err instanceof Error ? err.message : String(err)}${causeMsg}`;
  }

  return {
    agent_source: envSeat,
    agent_source_provenance: 'env',
    ...(probeError !== undefined && { attribution_probe_error: probeError }),
  };
}
