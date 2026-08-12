/**
 * Declared seat lifecycle — the per-seat `lifecycle.json` marker behind
 * `totem seat add | suspend | remove | list` (mmnto-ai/totem#2511).
 *
 * Seat EXISTENCE stays dir-derived (`readSeatDirs`, the mmnto-ai/totem#2141
 * dirs-union invariant): a seat's first write registers it, and this file adds
 * no second registration surface. An ABSENT marker means `active`, so a
 * markerless tree behaves bit-identically to a pre-#2511 one. Lifecycle
 * filters downstream consumers (broadcast denominators, annotations); it never
 * decides who exists — `resolveSelfAgents` stays lifecycle-blind.
 *
 * Reads FAIL OPEN and LOUD: an unreadable or invalid marker degrades to
 * `active` with a warning that names the marker file, because a corrupt marker
 * must never shrink a broadcast denominator (wrongly closing an obligation)
 * nor hide held mail. Writes fail HARD: the atomic helper leaves the old
 * marker or the new one, never a torn transition.
 *
 * The whole tree is gitignored, so markers are machine-local by design —
 * the same scope ECL coordination already has.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { getErrorMessage, TotemError, type TotemErrorCode } from './errors.js';
import { writeFileAtomicSync } from './fs-atomic.js';
import { isPathSafeAgentId, readSeatDirs } from './orchestration-resolver.js';

/** Marker filename inside `<repoRoot>/.totem/orchestration/<seat>/`. */
export const SEAT_LIFECYCLE_FILENAME = 'lifecycle.json';

/** The on-disk compatibility contract for a lifecycle marker. */
export const SEAT_LIFECYCLE_SCHEMA_VERSION = 1;

const TOTEM_DIR = '.totem';
const ORCHESTRATION_DIR = 'orchestration';

/**
 * Errno values that PROVE a marker is absent rather than unreadable. Every
 * other errno is a real read failure and earns a warning: "I could not tell"
 * must never render as "there is no marker" (`worktreePathExists`'s posture).
 */
const MARKER_ABSENT_ERRNOS: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);

/**
 * `errors.ts` is out of this slice's scope, so the two refusal classes reuse
 * existing codes and are named here — one edit site if a `SEAT_*` code is
 * later minted.
 */
const SEAT_LIFECYCLE_INVALID_CODE: TotemErrorCode = 'CONFIG_INVALID';
const SEAT_LIFECYCLE_WRITE_FAILED_CODE: TotemErrorCode = 'CHECK_FAILED';

/**
 * The closed lifecycle set. DECLARED state only — operator-driven and durable.
 * Session state (`LIVE`/`IDLE`/`FAULTED`) is a different axis entirely: it is
 * DERIVED by the totem-status#127 projection, which CONSUMES lifecycle.
 */
export const SeatLifecycleStateSchema = z.enum(['active', 'suspended', 'retired']);
export type SeatLifecycleState = z.infer<typeof SeatLifecycleStateSchema>;

/**
 * The `lifecycle.json` payload.
 *
 * `.strict()` plus the closed enum is what makes the totem-status#127 axis
 * ruling STRUCTURAL rather than advisory: session-state vocabulary
 * (`LIVE`/`IDLE`/`FAULTED`) is unrepresentable here — not as a `state` value
 * (the enum rejects it) and not as a smuggled sibling key (strict rejects it).
 * A marker can only ever say what was declared.
 *
 * `by` is resolved from the environment BY CALLERS (the `TOTEM_SELF_AGENT`
 * seat) or honestly absent — a stamped absence, never a fabricated attribution
 * (the mmnto-ai/totem#2625 MB-2 rule).
 */
export const SeatLifecycleMarkerSchema = z
  .object({
    schemaVersion: z.literal(SEAT_LIFECYCLE_SCHEMA_VERSION),
    state: SeatLifecycleStateSchema,
    /** ISO-8601 instant of the transition, stamped at the write site. */
    since: z.string().datetime({ offset: true }),
    by: z.string().trim().min(1).optional(),
    /** Operator's recorded ruling — the §6.6 audit trail when present. */
    reason: z.string().optional(),
  })
  .strict();

export type SeatLifecycleMarker = z.infer<typeof SeatLifecycleMarkerSchema>;

/**
 * A seat's lifecycle as read from disk.
 *
 * - `source: 'marker'` ⟹ a valid marker answered; `marker` carries it.
 * - `source: 'default-active'` ⟹ no usable marker (absent, unreadable, or
 *   invalid). `warning` is present for every case EXCEPT a plainly absent
 *   marker, which is the expected steady state of every legacy seat.
 */
export interface SeatLifecycleRead {
  state: SeatLifecycleState;
  source: 'marker' | 'default-active';
  marker?: SeatLifecycleMarker;
  warning?: string;
}

/** One row of `deriveSeatStatuses` — a seat plus its read-time lifecycle. */
export interface SeatStatus extends SeatLifecycleRead {
  seat: string;
  since?: string;
}

/** Absolute path to a seat's marker file. Caller guarantees a safe `agentId`. */
function markerPathFor(repoRoot: string, agentId: string): string {
  return path.join(
    path.resolve(repoRoot),
    TOTEM_DIR,
    ORCHESTRATION_DIR,
    agentId,
    SEAT_LIFECYCLE_FILENAME,
  );
}

/** The fail-open answer: a seat with no usable marker is `active`. */
function defaultActive(warning?: string): SeatLifecycleRead {
  return warning === undefined
    ? { state: 'active', source: 'default-active' }
    : { state: 'active', source: 'default-active', warning };
}

/**
 * The degraded-read warning. It names the marker file because the recovery
 * route is "fix or delete the marker" — the message hands over the one-step
 * target rather than making the reader hunt for it.
 */
function unusableMarkerWarning(markerPath: string, agentId: string, detail: string): string {
  return `seat "${agentId}": unusable lifecycle marker at ${markerPath} (${detail}) — treating the seat as active; fix or delete the marker`;
}

/** Flatten zod issues into one line for a warning or error detail. */
function describeIssues(err: z.ZodError): string {
  return err.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
}

/**
 * Read one seat's declared lifecycle. NEVER throws — every failure direction
 * lands on `active` with a warning, because refusing to answer would take a
 * poll, a `seat list`, or a doctor check down with one bad file.
 *
 * An unsafe `agentId` degrades the same way rather than throwing: this is a
 * read path, and the caller may be enumerating ids it did not choose.
 */
export function readSeatLifecycle(repoRoot: string, agentId: string): SeatLifecycleRead {
  if (!isPathSafeAgentId(agentId)) {
    // JSON.stringify escapes control characters: echoing a raw unsafe id into
    // a CLI log is the terminal-injection class the guard exists to stop.
    return defaultActive(
      `unsafe seat id ${JSON.stringify(agentId)} — refusing to resolve a lifecycle marker path; treating the seat as active`,
    );
  }

  const markerPath = markerPathFor(repoRoot, agentId);

  let raw: string;
  // totem-context: intentional degradation — the catch IS the answer: ENOENT/ENOTDIR PROVE the marker is absent (the expected state of every seat that predates #2511, silent by contract), and every other errno degrades LOUDLY to active so a corrupt marker can never shrink a broadcast denominator.
  try {
    raw = fs.readFileSync(markerPath, 'utf-8');
    // totem-context: intentional degradation — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
  } catch (err) {
    const code =
      err !== null && typeof err === 'object' && 'code' in err
        ? (err as NodeJS.ErrnoException).code
        : undefined;
    if (code !== undefined && MARKER_ABSENT_ERRNOS.has(code)) {
      return defaultActive();
    }
    return defaultActive(unusableMarkerWarning(markerPath, agentId, getErrorMessage(err)));
  }

  let payload: unknown;
  // totem-context: intentional degradation — malformed JSON is the corrupt-marker failure mode (#2511 failure table): warn naming the file and fail open to active, never throw out of a read path.
  try {
    payload = JSON.parse(raw);
    // totem-context: intentional degradation — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
  } catch (err) {
    return defaultActive(unusableMarkerWarning(markerPath, agentId, getErrorMessage(err)));
  }

  const parsed = SeatLifecycleMarkerSchema.safeParse(payload);
  if (!parsed.success) {
    return defaultActive(unusableMarkerWarning(markerPath, agentId, describeIssues(parsed.error)));
  }

  return { state: parsed.data.state, source: 'marker', marker: parsed.data };
}

/**
 * Write (or replace) one seat's marker atomically and return the marker path.
 *
 * Overwriting an existing marker — including a corrupt one — is deliberate:
 * the verbs ARE the recovery path for the degraded read above. Callers surface
 * the pre-write warning from `readSeatLifecycle`; they do not refuse the write.
 *
 * Throws on an unsafe seat id or a schema-invalid marker (both are caller
 * errors that must not reach disk) and on any I/O failure — the atomic helper
 * guarantees the old marker survives a failed write.
 */
export function writeSeatLifecycle(
  repoRoot: string,
  agentId: string,
  marker: SeatLifecycleMarker,
): string {
  if (!isPathSafeAgentId(agentId)) {
    throw new TotemError(
      SEAT_LIFECYCLE_INVALID_CODE,
      `Refusing to write a lifecycle marker for unsafe seat id ${JSON.stringify(agentId)}.`,
      'Seat ids are single path segments: no separators, `..`, null byte, control/whitespace, or win32-reserved characters.',
    );
  }

  const parsed = SeatLifecycleMarkerSchema.safeParse(marker);
  if (!parsed.success) {
    throw new TotemError(
      SEAT_LIFECYCLE_INVALID_CODE,
      `Refusing to write a lifecycle marker that violates the schema: ${describeIssues(parsed.error)}`,
      'The marker schema is strict by contract (session state is not lifecycle state) — fix the caller rather than widening the schema.',
    );
  }

  const markerPath = markerPathFor(repoRoot, agentId);
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileAtomicSync(markerPath, JSON.stringify(parsed.data, null, 2) + '\n');
  } catch (err) {
    throw new TotemError(
      SEAT_LIFECYCLE_WRITE_FAILED_CODE,
      `Could not write the lifecycle marker at ${markerPath}: ${getErrorMessage(err)}`,
      'Check write permissions on the seat directory and free disk space, then re-run — the write is atomic, so the seat is still in its previous state.',
      err,
    );
  }
  return markerPath;
}

/**
 * Every registered seat in a repo with its declared lifecycle, sorted by seat
 * (`readSeatDirs` order).
 *
 * DERIVED at read time and never cached or persisted (Tenet 20): the dirs are
 * the roster and the markers are the state, so a transition is visible to the
 * very next read with no invalidation step — which is what lets `pollMail`
 * consume per-invocation markers without a staleness seam.
 */
export function deriveSeatStatuses(repoRoot: string): SeatStatus[] {
  return readSeatDirs(repoRoot).map((seat) => {
    const read = readSeatLifecycle(repoRoot, seat);
    const status: SeatStatus = { seat, state: read.state, source: read.source };
    if (read.marker !== undefined) {
      status.since = read.marker.since;
      status.marker = read.marker;
    }
    if (read.warning !== undefined) {
      status.warning = read.warning;
    }
    return status;
  });
}
