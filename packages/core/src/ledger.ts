import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { checkQbdCorrelationId } from './qbd/correlation-id.js';

// ─── Schema ─────────────────────────────────────────

/**
 * Every ledger event type, in one place.
 *
 * Consumers that need to partition the type space (e.g. the query-before-derive
 * scanner, which must tell "another subsystem's row" from "a row that concerns
 * me") MUST derive their sets from this constant rather than hand-mirroring it.
 * A hand-copied list silently rots the moment a type is added here, and for the
 * QBD scanner that rot changes a DEGRADED verdict — see `qbd/compliance.ts`.
 */
export const LEDGER_EVENT_TYPES = [
  'suppress',
  'override',
  'exemption',
  'mcp_call',
  'tool_call_first_significant',
  'hook_fire',
  'session_start',
  'compile_run',
  'claim_discipline_finding',
  'compile_cache_decision',
  'corpus_query',
  'derive_action',
] as const;

/** Ledger event types that belong to the query-before-derive metric (#2510). */
export const QBD_EVENT_TYPES = ['corpus_query', 'derive_action'] as const;

const LedgerEventShape = z.object({
  /** ISO 8601 timestamp */
  timestamp: z.string().datetime(),
  /**
   * Event type. Two semantic families:
   *
   *  Override events (require `ruleId` + `file` at writer side):
   *  - `suppress`  — inline directive (`// totem-ignore`, `// totem-context:`)
   *  - `override`  — `shield --override`
   *  - `exemption` — auto/manual pattern exemption
   *
   *  Activity events (require `agent_source` + `session_id` at writer side; no rule context):
   *  - `mcp_call`                    — MCP tool invocation (see `activity_name` for which tool)
   *  - `tool_call_first_significant` — first non-Read/Grep/Glob orchestrator tool call in session
   *  - `hook_fire`                   — lifecycle hook executed (see `activity_name` for which hook)
   *  - `session_start`               — SessionStart hook fired; new `session_id` minted
   *  - `compile_run`                 — `totem compile` worker invocation (see `activity_name` for provider).
   *                                    Best-effort `session_id` only; `agent_source` deferred to A.3.c when
   *                                    the orchestrator → telemetry correlation lands (same constraint as
   *                                    `mcp_call`, which also leaves `agent_source` undefined today).
   *  - `claim_discipline_finding`    — `totem doctor --claim-discipline` fired on a public-surface diff
   *                                    (README/AGENTS/design-tenets/wiki); see `ruleId` for which WWND
   *                                    rule fired and `activity_name` for the surface (Proposal 279).
   *  - `compile_cache_decision`      — per-lesson per-compile-run record of cache outcome; `ruleId`
   *                                    carries the lesson sourceHash and `activity_name` carries the
   *                                    decision enum value (`cache_hit` / `cache_miss_source_changed` /
   *                                    `cache_miss_fingerprint_changed` / `cache_miss_force` /
   *                                    `cache_miss_no_prior_record`) per Proposal 281.
   *
   *  Query-before-derive events (mmnto-ai/totem#2510; see `qbd/`):
   *  - `corpus_query`  — a corpus query fired (`totem search` CLI or the MCP `search_knowledge`
   *                      tool); `activity_name` carries which surface. Mints a fresh
   *                      `qbd_correlation_id` at write time.
   *  - `derive_action` — a derive-class action ran (`totem spec` synthesis, `totem orient`
   *                      derivation, `totem review` grounding); `activity_name` carries which.
   *                      Carries the `qbd_correlation_id` of the query that grounded it, or
   *                      NO id when nothing grounded it — an uncorrelated derive is a real,
   *                      countable data point, never a dropped row (#2510 falsifier 1).
   *
   *  Schema-level: `ruleId` + `file` are optional to accommodate activity events. Writer-side
   *  discipline enforces required-by-type. Promotion to `z.discriminatedUnion` deferred to A.3.c
   *  per design doc OQ-1 (.handoff/_shared/2026-05-15-a3a-schema-extension-design.md).
   */
  type: z.enum(LEDGER_EVENT_TYPES),
  /** Rule ID (lessonHash) for override events. Optional; required by writer for suppress/override/exemption. */
  ruleId: z.string().trim().min(1).optional(),
  /** File where the suppression/override occurred. Optional; required by writer for suppress/override/exemption. */
  file: z.string().trim().min(1).optional(),
  /** Line number in the file */
  line: z.number().int().positive().optional(),
  /** The justification text from totem-context: (or deprecated shield-context: alias). Empty for totem-ignore. */
  justification: z.string().default(''),
  /**
   * Emitting subsystem. Identifies which code path produced the event,
   * orthogonal to `agent_source` (agent runtime attribution).
   */
  source: z.enum(['lint', 'shield', 'bot']),
  /**
   * True when the bypassed rule was shipped by a pack with
   * `immutable: true`. Audit consumers can filter
   * `events.ndjson | jq 'select(.immutable == true)'` to surface every
   * attempt to silence an enforced security rule (ADR-089,
   * mmnto-ai/totem#1485). Absent on events from non-immutable rules.
   */
  immutable: z.boolean().optional(),
  /**
   * Agent identity that produced the event. Orthogonal to `source`
   * (which identifies the emitting subsystem). Optional for
   * backward-compat with pre-A.3.a events; required by writer for
   * activity events. Per ADR-078 § Event Attribution (amended
   * 2026-07-15, strategy#879 / #2362 fold-1): the value space is
   * seat-id ∪ {`human`} (e.g. `strategy-claude`, `lc-codex`,
   * `human`), env-carried as `TOTEM_SELF_AGENT`. A vendor class
   * projects mechanically from a seat (`strategy-claude` → `claude`);
   * the reverse projection does not exist, so vendor literals must
   * never be stamped. Open string, not an enum: the seat roster is
   * open-ended, and `readLedgerEvents` silently skips schema-invalid
   * lines — a closed set here turns new seats into data loss.
   * Legacy vendor-class values (`claude`/`gemini`/`human`) from
   * pre-amendment writers remain parseable.
   */
  agent_source: z.string().trim().min(1).optional(),
  /**
   * Session UUID minted at SessionStart hook fire (24h TTL, rotates on
   * subsequent SessionStart). Persisted to `.totem/ledger/.session-id`
   * for cross-event correlation within a session. Per ADR-029 § Session
   * Heuristic (explicit UUID supersedes the rolling-2h activity heuristic
   * when present). Optional for backward-compat.
   */
  session_id: z.string().uuid().optional(),
  /**
   * Trace correlation ID per ADR-014 — links an orchestrator run to
   * the MCP tool calls it triggered. Optional; populated by A.3.c
   * end-to-end correlation propagation.
   */
  correlation_id: z.string().uuid().optional(),
  /**
   * Sub-type discriminator for activity events. Examples:
   *   `mcp_call`  → 'search_knowledge' | 'describe_project' | ...
   *   `hook_fire` → 'SessionStart' | 'PreToolUse' | 'pre-push' | ...
   *   `claim_discipline_finding` → 'README.md' | 'AGENTS.md' | 'design-tenets.md' | 'docs/wiki/...'
   * Optional; meaningful only on activity events.
   */
  activity_name: z.string().trim().min(1).optional(),
  /**
   * CLI semver (`@mmnto/cli` package.json `version`) that produced the event.
   * Used to correlate gate behavior with cli releases when investigating
   * findings post-merge. Per Proposal 279 § Telemetry; additive for all
   * activity-event consumers, not just `claim_discipline_finding`.
   */
  cli_version: z.string().trim().min(1).optional(),
  /**
   * True when a `claim_discipline_finding` (or any future bypass-able gate)
   * was addressed inside the same PR that introduced it. Computed at merge
   * time by post-merge replay against the PR-body justification heading.
   * Per Proposal 279 § Telemetry; scoped to claim-discipline events by
   * writer convention even though the field lives on the base schema.
   */
  addressed_in_pr: z.boolean().optional(),
  /**
   * Query-before-derive correlation ID (mmnto-ai/totem#2510) — the join key
   * between a `corpus_query` row and the `derive_action` rows that query
   * grounded. Distinct from `correlation_id` (ADR-014 orchestrator→MCP trace),
   * which this slice is explicitly not chartered to build on.
   *
   * Self-dating by construction: the ID embeds its own mint instant, and
   * `LedgerEventSchema`'s refinement below cross-checks that instant against
   * this row's `timestamp`. That is what makes "minted at event-write time" a
   * schema constraint rather than a convention — see `qbd/correlation-id.ts`
   * for the exact contract and its honest limits.
   *
   * Absent on a `derive_action` = that derive was not grounded by a query. That
   * is the metric's most important signal, not a gap: it must be counted in the
   * denominator (#2510 falsifier 1, denominator gaming).
   */
  qbd_correlation_id: z.string().trim().min(1).optional(),
});

/**
 * The Trap Ledger event schema.
 *
 * The refinement enforces the #2510 minted-at-write-time contract structurally:
 * a row whose `qbd_correlation_id` could not have been minted when the row was
 * written fails to parse. Per the charter, "a backfilled ID is a schema
 * violation, not a data point" — so such a row is never counted as compliant by
 * anyone reading through this schema.
 *
 * Note for readers: `readLedgerEvents` SKIPS schema-invalid lines, so a
 * violating row silently disappears from generic consumers. The compliance
 * scanner (`qbd/compliance.ts`) therefore does NOT read through that helper —
 * it counts every rejected row per-item so a tampered or torn ledger renders as
 * DEGRADED instead of as a clean number (ADR-115 § 2).
 */
export const LedgerEventSchema = LedgerEventShape.superRefine((event, ctx) => {
  if (event.qbd_correlation_id === undefined) return;
  const eventMs = Date.parse(event.timestamp);
  if (!Number.isFinite(eventMs)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['qbd_correlation_id'],
      message: 'qbd_correlation_id present on a row with an unparseable timestamp',
    });
    return;
  }
  const check = checkQbdCorrelationId(event.qbd_correlation_id, event.type, eventMs);
  if (!check.ok) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['qbd_correlation_id'],
      message: `${check.violation ?? 'invalid'}: ${check.detail ?? 'invalid qbd_correlation_id'}`,
    });
  }
});

export type LedgerEvent = z.infer<typeof LedgerEventSchema>;

// ─── Constants ──────────────────────────────────────

const LEDGER_DIR = 'ledger';
const EVENTS_FILE = 'events.ndjson';

// ─── Append Logic ───────────────────────────────────

/**
 * Append an event to the Trap Ledger (.totem/ledger/events.ndjson).
 *
 * Fire-and-forget: I/O failures are logged as warnings, never crash the caller.
 * Uses appendFileSync to prevent interleaving in single-threaded CLI.
 */
export function appendLedgerEvent(
  totemDir: string,
  event: LedgerEvent,
  onWarn?: (msg: string) => void,
): void {
  try {
    const ledgerDir = path.join(totemDir, LEDGER_DIR);
    fs.mkdirSync(ledgerDir, { recursive: true });

    const filePath = path.join(ledgerDir, EVENTS_FILE);
    // JSON.stringify handles newline escaping in justification strings
    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(filePath, line, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onWarn?.(`Trap Ledger write failed: ${msg}`);
  }
}

/**
 * Read all events from the Trap Ledger. Returns parsed events, skipping invalid lines.
 * Useful for `totem stats` and `totem doctor --pr`.
 */
export function readLedgerEvents(totemDir: string, onWarn?: (msg: string) => void): LedgerEvent[] {
  const filePath = path.join(totemDir, LEDGER_DIR, EVENTS_FILE);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    const events: LedgerEvent[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const result = LedgerEventSchema.safeParse(parsed);
        if (result.success) {
          events.push(result.data);
        }
      } catch {
        // Skip malformed lines
      }
    }
    return events;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    const msg = err instanceof Error ? err.message : String(err);
    onWarn?.(`Trap Ledger read failed: ${msg}`);
    return [];
  }
}
