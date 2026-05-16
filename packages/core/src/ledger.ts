import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

// ─── Schema ─────────────────────────────────────────

export const LedgerEventSchema = z.object({
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
   *
   *  Schema-level: `ruleId` + `file` are optional to accommodate activity events. Writer-side
   *  discipline enforces required-by-type. Promotion to `z.discriminatedUnion` deferred to A.3.c
   *  per design doc OQ-1 (.handoff/_shared/2026-05-15-a3a-schema-extension-design.md).
   */
  type: z.enum([
    'suppress',
    'override',
    'exemption',
    'mcp_call',
    'tool_call_first_significant',
    'hook_fire',
    'session_start',
    'compile_run',
  ]),
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
   * Agent runtime that produced the event. Orthogonal to `source`
   * (which identifies the emitting subsystem). Optional for
   * backward-compat with pre-A.3.a events; required by writer for
   * activity events. Per ADR-078 § Event Attribution, with the
   * field renamed from `source` to disambiguate against the
   * load-bearing emitter identifier already in production code.
   */
  agent_source: z.enum(['claude', 'gemini', 'human']).optional(),
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
   * Optional; meaningful only on activity events.
   */
  activity_name: z.string().trim().min(1).optional(),
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
