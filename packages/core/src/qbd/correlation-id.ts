/**
 * Query-before-derive (QBD) correlation IDs — the join key between a corpus
 * query event and the derive-class action it grounded (mmnto-ai/totem#2510).
 *
 * ## Why a bespoke ID and not `correlation_id`
 *
 * `LedgerEvent.correlation_id` is ADR-014's orchestrator→MCP trace ID and is a
 * plain UUID. #2510 is explicitly NOT chartered to build the ADR-014 telemetry
 * stack, so this slice carries its own field (`qbd_correlation_id`) with its
 * own format. A UUID carries no mint instant, and the mint instant is exactly
 * what makes falsifier 2 (post-hoc correlation) mechanically checkable.
 *
 * ## Format
 *
 * `qbd1-<mintInstantMs base36>-<16 hex random>` — e.g.
 * `qbd1-2h1s4kbqr-9f2c0a7e51d34b60`.
 *
 * The ID is **self-dating**: it embeds the wall-clock instant at which it was
 * minted. That is the whole point. Validation (below) cross-checks the embedded
 * instant against the timestamp of the row carrying the ID, which turns
 * "IDs must be minted at event-write time" from a convention into a schema
 * constraint (#2510 falsifier 2: "a backfilled ID is a schema violation, not a
 * data point").
 *
 * ## What the validation actually catches — and what it does not
 *
 * Catches (mechanically, at parse time, for every reader and writer):
 *  - a query row whose ID predates or postdates its own write instant beyond
 *    `QBD_MINT_TOLERANCE_MS` — i.e. an ID minted anywhere other than at the
 *    moment the row was written;
 *  - a derive row carrying an ID minted *after* the derive happened (an ID that
 *    did not exist when the derive ran cannot have grounded it);
 *  - a derive row carrying an ID minted longer ago than the correlation window
 *    (retroactively dressing an ancient query as this derive's grounding);
 *  - `qbd_correlation_id` stamped on an event type that has no query→derive
 *    semantics at all.
 *
 * On the tolerance: the checks are "beyond tolerance", NOT categorical. A
 * mismatch inside `QBD_MINT_TOLERANCE_MS` passes in both directions, including
 * a mint instant slightly in the future of its row. That window exists for
 * clock granularity between two reads of the same clock, and it is small
 * relative to the correlation window — but it is a real gap, and calling these
 * checks categorical would overstate them.
 *
 * ## What this does NOT catch, stated precisely
 *
 * This is a per-row consistency check, so it cannot see relationships BETWEEN
 * rows. Two attacks live in that gap:
 *
 *  1. **Backdated appends.** `mintQbdCorrelationId` takes its instant as an
 *     argument and is public API, and the ledger is append-only — so coherent
 *     query/derive pairs stamped in the past can simply be appended. No
 *     whole-file rewrite is needed. Each row passes this check individually.
 *     That attack is caught one layer up, by the append-only monotonicity check
 *     in `compliance.ts`, which degrades a scan whose timestamps regress.
 *  2. **A coherent whole-file rewrite.** Rewriting the entire ledger with
 *     internally consistent, monotonically increasing fake rows defeats both
 *     this check and the monotonicity check. Nothing short of signing or an
 *     append-only server would stop it, and neither is in scope for v1.
 *
 * The realistic threat — a script or agent attaching correlation IDs to rows
 * already on disk — is caught here. The other two are named rather than
 * claimed solved, per the #2510 discipline.
 */

import * as crypto from 'node:crypto';

// ─── Constants ──────────────────────────────────────────

/** Format version prefix — bump if the encoding ever changes. */
const QBD_ID_PREFIX = 'qbd1';

/** Bytes of randomness in the ID suffix (16 hex chars). */
const QBD_ID_RANDOM_BYTES = 8;

/** Radix for the embedded mint instant. */
const MINT_RADIX = 36;

/**
 * Correlation window: a derive-class action counts as grounded by a query only
 * if that query was minted within this window before it.
 *
 * The VALUE is borrowed from ADR-029 § 2's two-hour session window so this
 * slice does not invent a second time constant. The DECISION to treat that
 * span as a grounding-validity window is this slice's own, not the ADR's —
 * ADR-029 § 2 defines a session-GROUPING heuristic for the recall metric, which
 * is a different question, and it should not be cited as authority for this
 * choice. Owned here as a design call: a shorter window would be a strictly
 * harder test of the same claim, and the value is pinned so the pre-registered
 * threshold is evaluated against a fixed rule rather than a tunable one.
 *
 * Note that consume-on-use (see `record.ts`) does most of the real work: the
 * window bounds how STALE a grounding may be, but a query grounds only one
 * derive regardless, so a generous window cannot inflate the numerator.
 */
export const QBD_CORRELATION_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Tolerance for clock jitter between minting an ID and stamping the row's
 * `timestamp`. These happen microseconds apart in the same function, so this is
 * generous; it exists so a coarse clock or a slow filesystem never manufactures
 * a spurious schema violation.
 */
export const QBD_MINT_TOLERANCE_MS = 2000;

/** Structural shape of a QBD correlation ID. */
const QBD_ID_PATTERN = /^qbd1-([0-9a-z]{1,11})-[0-9a-f]{16}$/;

// ─── Types ──────────────────────────────────────────────

/** Why a correlation ID failed validation. Rendered verbatim in accounting. */
export type QbdIdViolation =
  | 'malformed-shape'
  | 'undecodable-mint-instant'
  | 'query-id-not-self-minted'
  | 'derive-id-minted-after-derive'
  | 'derive-id-older-than-window'
  | 'id-on-non-qbd-event';

export interface QbdIdCheckResult {
  ok: boolean;
  /** Populated when `ok` is false. */
  violation?: QbdIdViolation;
  /** Human-readable detail for accounting output. */
  detail?: string;
}

// ─── Mint ───────────────────────────────────────────────

/**
 * Mint a correlation ID stamped with `mintedAtMs`.
 *
 * Callers MUST pass the same instant they stamp on the event row — see
 * `record.ts`, which derives both from one `Date.now()` read. Every writer path
 * in this slice goes through that module precisely so the two cannot drift.
 */
export function mintQbdCorrelationId(mintedAtMs: number): string {
  if (!Number.isFinite(mintedAtMs) || mintedAtMs < 0) {
    throw new RangeError(`mintQbdCorrelationId: invalid mint instant ${String(mintedAtMs)}`);
  }
  const stamp = Math.floor(mintedAtMs).toString(MINT_RADIX);
  const random = crypto.randomBytes(QBD_ID_RANDOM_BYTES).toString('hex');
  return `${QBD_ID_PREFIX}-${stamp}-${random}`;
}

/**
 * Decode the mint instant embedded in a correlation ID.
 * Returns `undefined` when the ID is not a well-formed QBD ID.
 */
export function decodeQbdMintInstant(id: string): number | undefined {
  const match = QBD_ID_PATTERN.exec(id);
  if (match === null) return undefined;
  const decoded = parseInt(match[1]!, MINT_RADIX);
  if (!Number.isFinite(decoded) || decoded < 0) return undefined;
  return decoded;
}

// ─── Validate (the anti-backfill contract) ──────────────

/**
 * The minted-at-write-time contract, enforced structurally.
 *
 * `eventType` is the ledger row's `type`; `eventMs` is `Date.parse(row.timestamp)`.
 *
 * - `corpus_query`: the ID must be minted at the row's own instant (± tolerance).
 *   A query row is the ID's birth certificate; any other mint instant means the
 *   ID was attached later.
 * - `derive_action`: the ID must be minted at or before the derive (± tolerance)
 *   and no earlier than one correlation window before it.
 * - any other type: carrying the field at all is a violation.
 */
export function checkQbdCorrelationId(
  id: string,
  eventType: string,
  eventMs: number,
): QbdIdCheckResult {
  if (QBD_ID_PATTERN.exec(id) === null) {
    return {
      ok: false,
      violation: 'malformed-shape',
      detail: `'${id}' is not a qbd1-<base36 instant>-<16 hex> correlation ID`,
    };
  }

  const mintedAtMs = decodeQbdMintInstant(id);
  if (mintedAtMs === undefined) {
    return {
      ok: false,
      violation: 'undecodable-mint-instant',
      detail: `'${id}' has no readable mint instant`,
    };
  }

  if (eventType === 'corpus_query') {
    if (Math.abs(eventMs - mintedAtMs) > QBD_MINT_TOLERANCE_MS) {
      return {
        ok: false,
        violation: 'query-id-not-self-minted',
        detail: `query row stamped ${new Date(eventMs).toISOString()} carries an ID minted ${new Date(mintedAtMs).toISOString()} — a query event's ID is minted as the row is written, so this ID was attached after the fact`,
      };
    }
    return { ok: true };
  }

  if (eventType === 'derive_action') {
    if (mintedAtMs - eventMs > QBD_MINT_TOLERANCE_MS) {
      return {
        ok: false,
        violation: 'derive-id-minted-after-derive',
        detail: `derive row stamped ${new Date(eventMs).toISOString()} carries an ID minted ${new Date(mintedAtMs).toISOString()} — a query that had not happened yet cannot have grounded this derive`,
      };
    }
    if (eventMs - mintedAtMs > QBD_CORRELATION_WINDOW_MS) {
      return {
        ok: false,
        violation: 'derive-id-older-than-window',
        detail: `derive row stamped ${new Date(eventMs).toISOString()} carries an ID minted ${new Date(mintedAtMs).toISOString()}, older than the ${QBD_CORRELATION_WINDOW_MS}ms correlation window`,
      };
    }
    return { ok: true };
  }

  return {
    ok: false,
    violation: 'id-on-non-qbd-event',
    detail: `event type '${eventType}' has no query→derive semantics but carries a qbd_correlation_id`,
  };
}
