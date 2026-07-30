/**
 * Query-before-derive (QBD) event writers (mmnto-ai/totem#2510).
 *
 * Two row types, one contract:
 *
 *  - `recordCorpusQuery`  — a corpus query fired. Mints a fresh correlation ID
 *    **from the same clock read that stamps the row's `timestamp`**, so the ID
 *    and the row are born together. Then parks the ID in a pointer file for the
 *    derives that follow.
 *  - `recordDeriveAction` — a derive-class action ran. Reads the parked ID and
 *    attaches it *only if* it is still inside the correlation window and belongs
 *    to this session. Otherwise the row is written with NO correlation ID — an
 *    uncorrelated derive is the metric's most important observation, so it is
 *    always recorded, never dropped (#2510 falsifier 1).
 *
 * ## Why minting lives here and nowhere else
 *
 * `mintQbdCorrelationId(now)` takes the instant as an argument, which would let
 * a caller pass any instant it liked. Every production writer goes through this
 * module, where `now` is read once and used for BOTH the ID and the timestamp.
 * A caller that tried to route around it would have to hand-build a row, and the
 * schema refinement in `ledger.ts` rejects any row whose ID could not have been
 * minted when the row was written. Convention here, enforcement in the schema.
 *
 * ## Failure posture (Tenet 13 + ADR-115 § 2)
 *
 * A contract breach — a pointer file holding a forged, malformed, or
 * out-of-window ID — makes the schema reject the row, and these functions THROW
 * (the loud backstop; a backfilled ID is a schema violation, not a data point).
 * An ordinary I/O failure does not throw; it is reported through the returned
 * `warnings` array.
 *
 * Neither may break the instrumented command. That is what the `sense*`
 * wrappers are for: they catch the backstop, convert it to a visible warning,
 * and return. Command call sites use `sense*`; the throwing variants exist so
 * the contract is testable and so a programming error is never silent.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { TotemError } from '../errors.js';
import type { LedgerEvent } from '../ledger.js';
import { appendLedgerEvent, LedgerEventSchema } from '../ledger.js';
import { readSessionId } from '../session-id.js';
import {
  checkQbdCorrelationId,
  mintQbdCorrelationId,
  QBD_CORRELATION_WINDOW_MS,
} from './correlation-id.js';

// ─── Constants ──────────────────────────────────────────

const LEDGER_DIR = 'ledger';

/**
 * Where the most recently minted correlation ID is parked for the derives that
 * follow it. Mirrors the `.session-id` pointer convention deliberately — same
 * directory, same fire-and-forget posture, same "a missing pointer is a normal
 * state" reading.
 */
const QBD_POINTER_FILE = '.qbd-correlation';

/** UUID shape check — `session_id` is `z.string().uuid()` in the ledger schema. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Which surface fired a `corpus_query`. Stamped as `activity_name`. */
export type QbdQuerySurface = 'totem_search' | 'search_knowledge';

/** Which derive-class action ran. Stamped as `activity_name`. */
export type QbdDeriveSurface = 'spec' | 'orient' | 'review';

// ─── Types ──────────────────────────────────────────────

export interface QbdRecordInput {
  /** Absolute path to the resolved `.totem` directory. */
  totemDir: string;
  /** Emitting subsystem: `lint` for CLI commands, `bot` for the MCP server. */
  source: 'lint' | 'bot';
  /** Test seam — production callers omit and the writer reads the clock. */
  nowMs?: number;
  /** Test seam — production callers omit and the writer reads `process.env`. */
  env?: NodeJS.ProcessEnv;
}

export interface QbdRecordResult {
  /** True when the ledger row reached disk. */
  written: boolean;
  /**
   * True when nothing was recorded because this is not an instrumented project
   * (no `.totem` directory). Distinguishes "nothing to instrument here" — a
   * normal state — from "the write failed", which is a degradation.
   */
  skipped?: boolean;
  /** The correlation ID on the row, when it carries one. */
  correlationId?: string;
  /**
   * Per-item accounting. Every non-fatal degradation names itself here; the
   * caller renders these so a sensor failure is visible, never silent
   * (ADR-115 § 2 accounting contract).
   */
  warnings: string[];
}

// ─── Env attribution ────────────────────────────────────

/**
 * Resolve the emitting seat from `TOTEM_SELF_AGENT`, reusing the comma-split
 * precedent of `deriveSearchLogAttribution` / `resolveSelfAgents` — a process
 * runs under one seat, so the first non-empty entry is that seat.
 */
export function resolveQbdAgentSource(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.TOTEM_SELF_AGENT;
  if (typeof raw !== 'string') return undefined;
  return (
    raw
      .split(',')
      .map((s) => s.trim())
      .find((s) => s.length > 0) ?? undefined
  );
}

/**
 * Resolve the session UUID: the `.session-id` pointer first (the established
 * primitive), then `TOTEM_SESSION_ID`. A value that is not UUID-shaped is
 * dropped rather than stamped — the ledger schema requires a UUID, and stamping
 * a malformed one would make the whole row unparseable, losing the event.
 */
function resolveSessionId(totemDir: string, env: NodeJS.ProcessEnv): string | undefined {
  const fromPointer = readSessionId(totemDir);
  if (fromPointer !== undefined) return fromPointer;
  const fromEnv = env.TOTEM_SESSION_ID;
  if (typeof fromEnv === 'string' && UUID_PATTERN.test(fromEnv.trim())) return fromEnv.trim();
  return undefined;
}

// ─── Correlation pointer ────────────────────────────────

interface QbdPointer {
  id: string;
  mintedAtMs: number;
  sessionId: string | null;
}

function pointerPath(totemDir: string): string {
  return path.join(totemDir, LEDGER_DIR, QBD_POINTER_FILE);
}

function writePointer(totemDir: string, pointer: QbdPointer, warnings: string[]): void {
  try {
    fs.mkdirSync(path.join(totemDir, LEDGER_DIR), { recursive: true });
    fs.writeFileSync(pointerPath(totemDir), JSON.stringify(pointer), 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`query-before-derive: correlation pointer write failed: ${msg}`);
  }
}

/**
 * Read the parked correlation pointer. A missing or unreadable pointer is a
 * normal state (first query of a session, fresh repo) and reads as `undefined`.
 *
 * A pointer that is present but structurally wrong is NOT silently ignored — it
 * is returned as-is so the schema check downstream rejects it loudly. Swallowing
 * it here would be exactly the silent-degradation shape ADR-115 § 2 forbids.
 */
function readPointer(totemDir: string, warnings: string[]): QbdPointer | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(pointerPath(totemDir), 'utf-8');
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null ? (err as NodeJS.ErrnoException).code : undefined;
    if (code !== 'ENOENT') {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`query-before-derive: correlation pointer unreadable: ${msg}`);
    }
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      warnings.push('query-before-derive: correlation pointer is not an object — ignoring');
      return undefined;
    }
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.id !== 'string' || typeof rec.mintedAtMs !== 'number') {
      warnings.push('query-before-derive: correlation pointer is missing id/mintedAtMs — ignoring');
      return undefined;
    }
    return {
      id: rec.id,
      mintedAtMs: rec.mintedAtMs,
      sessionId: typeof rec.sessionId === 'string' ? rec.sessionId : null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`query-before-derive: correlation pointer is not valid JSON (${msg}) — ignoring`);
    return undefined;
  }
}

// ─── Shared write path ──────────────────────────────────

/**
 * Is this an instrumented project at all?
 *
 * The derive-class commands (`orient` especially) run from anywhere, including
 * directories that are not Totem projects. `appendLedgerEvent` creates its
 * directory tree on demand, so without this guard the sensor would materialise a
 * stray `.totem/ledger/` in any directory a command happened to run in.
 *
 * An absent `.totem` is a NORMAL state, not a degradation — it means "nothing
 * here to instrument" — so this path is silent rather than warned. A totemDir
 * that EXISTS but cannot be written to is a different thing entirely, and that
 * still reports through the accounting channel.
 */
function isInstrumentedProject(totemDir: string): boolean {
  try {
    return fs.statSync(totemDir).isDirectory();
    // totem-context: a missing `.totem` is the honest "not a Totem project" state for this sensor — skip silently rather than creating a stray directory in an unrelated cwd.
  } catch {
    return false;
  }
}

/**
 * Validate against the ledger schema, then append.
 *
 * The schema carries the minted-at-write-time refinement, so this is the single
 * choke point where a backfilled or forged correlation ID becomes a thrown
 * error instead of a persisted "data point".
 */
function validateAndAppend(
  totemDir: string,
  event: LedgerEvent,
  warnings: string[],
): { written: boolean } {
  const parsed = LedgerEventSchema.safeParse(event);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => i.message).join('; ');
    throw new TotemError(
      'QBD_CORRELATION_CONTRACT',
      `Refusing to write a query-before-derive row that violates the correlation contract: ${detail}`,
      'A correlation ID must be minted at event-write time. Delete the stale `.totem/ledger/.qbd-correlation` pointer if it was hand-edited.',
    );
  }

  let written = true;
  appendLedgerEvent(totemDir, parsed.data, (msg) => {
    written = false;
    warnings.push(`query-before-derive: ${msg}`);
  });
  return { written };
}

// ─── Writers ────────────────────────────────────────────

/**
 * Record a corpus query and mint its correlation ID.
 *
 * `nowMs` is read ONCE and used for both the ID's embedded mint instant and the
 * row's `timestamp` — the property the schema refinement checks.
 */
export function recordCorpusQuery(
  input: QbdRecordInput & { surface: QbdQuerySurface },
): QbdRecordResult {
  const env = input.env ?? process.env;
  const nowMs = input.nowMs ?? Date.now();
  const warnings: string[] = [];

  if (!isInstrumentedProject(input.totemDir)) return { written: false, skipped: true, warnings };

  const correlationId = mintQbdCorrelationId(nowMs);
  const sessionId = resolveSessionId(input.totemDir, env);
  const agentSource = resolveQbdAgentSource(env);

  const event: LedgerEvent = {
    timestamp: new Date(nowMs).toISOString(),
    type: 'corpus_query',
    activity_name: input.surface,
    source: input.source,
    justification: '',
    qbd_correlation_id: correlationId,
    ...(sessionId !== undefined && { session_id: sessionId }),
    ...(agentSource !== undefined && { agent_source: agentSource }),
  };

  const { written } = validateAndAppend(input.totemDir, event, warnings);

  // Park the ID for following derives ONLY if the query row actually landed.
  // Parking an ID whose query row failed to write would manufacture orphan
  // correlations — derives pointing at a query that does not exist.
  if (written) {
    writePointer(
      input.totemDir,
      { id: correlationId, mintedAtMs: nowMs, sessionId: sessionId ?? null },
      warnings,
    );
  }

  return { written, correlationId, warnings };
}

/**
 * Shared derive write path used by both the throwing and the sensor variants.
 *
 * The parked pointer grounds this derive only when it is (a) inside the
 * correlation window, (b) from this session, and (c) contract-valid. Otherwise
 * the row is written WITHOUT an ID — the honest reading being that nothing
 * grounded this derive — and case (c) additionally reports a breach.
 */
function buildAndWriteDerive(input: QbdRecordInput & { surface: QbdDeriveSurface }): {
  result: QbdRecordResult;
  breach?: TotemError;
} {
  const env = input.env ?? process.env;
  const nowMs = input.nowMs ?? Date.now();
  const warnings: string[] = [];

  if (!isInstrumentedProject(input.totemDir)) {
    return { result: { written: false, skipped: true, warnings } };
  }

  const sessionId = resolveSessionId(input.totemDir, env);
  const agentSource = resolveQbdAgentSource(env);
  const pointer = readPointer(input.totemDir, warnings);

  let correlationId: string | undefined;
  let breach: TotemError | undefined;

  if (pointer !== undefined) {
    const sameSession =
      pointer.sessionId === null || sessionId === undefined || pointer.sessionId === sessionId;
    const withinWindow = nowMs - pointer.mintedAtMs <= QBD_CORRELATION_WINDOW_MS;
    // A stale or foreign pointer is not an error — it simply did not ground
    // this derive. The row is still written, uncorrelated, into the denominator.
    if (sameSession && withinWindow) {
      const check = checkQbdCorrelationId(pointer.id, 'derive_action', nowMs);
      if (check.ok) {
        correlationId = pointer.id;
      } else {
        // Contract breach: the parked ID could not have been minted at a moment
        // that would let it ground THIS derive (forged, hand-edited, or from a
        // clock that ran backwards). It is refused — but the derive row is still
        // written, uncorrelated, so the denominator never shrinks because the
        // sensor was tampered with (#2510 falsifier 1). The breach is then
        // raised loudly by the caller.
        breach = new TotemError(
          'QBD_CORRELATION_CONTRACT',
          `Refusing a query-before-derive correlation ID that violates the minted-at-write-time contract (${check.violation ?? 'invalid'}): ${check.detail ?? 'invalid id'}`,
          'Delete the `.totem/ledger/.qbd-correlation` pointer; it was hand-edited or written by a clock that disagrees with this one. The derive was recorded as uncorrelated.',
        );
      }
    }
  }

  const event: LedgerEvent = {
    timestamp: new Date(nowMs).toISOString(),
    type: 'derive_action',
    activity_name: input.surface,
    source: input.source,
    justification: '',
    ...(correlationId !== undefined && { qbd_correlation_id: correlationId }),
    ...(sessionId !== undefined && { session_id: sessionId }),
    ...(agentSource !== undefined && { agent_source: agentSource }),
  };

  const { written } = validateAndAppend(input.totemDir, event, warnings);
  const result: QbdRecordResult = {
    written,
    ...(correlationId !== undefined && { correlationId }),
    warnings,
  };
  return breach === undefined ? { result } : { result, breach };
}

/**
 * Record a derive-class action, attaching the correlation ID of the query that
 * grounded it when one is in scope.
 *
 * Throws on a correlation-contract breach — AFTER the derive row has been
 * written uncorrelated. The ledger is left correct either way; the throw is the
 * loud backstop that stops a tampered pointer from passing as a data point.
 */
export function recordDeriveAction(
  input: QbdRecordInput & { surface: QbdDeriveSurface },
): QbdRecordResult {
  const { result, breach } = buildAndWriteDerive(input);
  if (breach !== undefined) throw breach;
  return result;
}

// ─── Sensor wrappers (never throw) ──────────────────────

/**
 * Run a QBD writer as a pure sensor: it may degrade, it may not break the
 * command it instruments (Tenet 13 / #2510 "sensor failure is not command
 * failure").
 *
 * Every degradation — including a thrown contract breach — is surfaced through
 * `onWarn`. The accounting contract is "visible, not swallowed": there is no
 * path here that discards a failure silently.
 */
function senseQbd(run: () => QbdRecordResult, onWarn?: (msg: string) => void): QbdRecordResult {
  try {
    const result = run();
    for (const warning of result.warnings) onWarn?.(warning);
    return result;
    // totem-context: instrumentation is a sensor — a telemetry failure must never fail the instrumented command (Tenet 13); the failure is reported through onWarn, never discarded.
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const warning = `query-before-derive sensor failed: ${msg}`;
    onWarn?.(warning);
    return { written: false, warnings: [warning] };
  }
}

/** Sensor-safe `recordCorpusQuery`. Command call sites use this. */
export function senseCorpusQuery(
  input: QbdRecordInput & { surface: QbdQuerySurface },
  onWarn?: (msg: string) => void,
): QbdRecordResult {
  return senseQbd(() => recordCorpusQuery(input), onWarn);
}

/**
 * Sensor-safe `recordDeriveAction`. Command call sites use this.
 *
 * A correlation-contract breach is reported as a warning rather than thrown —
 * and, critically, the derive row it refused to correlate has still been
 * written, so `written` stays true and the denominator is intact.
 */
export function senseDeriveAction(
  input: QbdRecordInput & { surface: QbdDeriveSurface },
  onWarn?: (msg: string) => void,
): QbdRecordResult {
  return senseQbd(() => {
    const { result, breach } = buildAndWriteDerive(input);
    if (breach !== undefined) result.warnings.push(`query-before-derive: ${breach.message}`);
    return result;
  }, onWarn);
}
