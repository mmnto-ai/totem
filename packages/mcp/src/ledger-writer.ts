/**
 * MCP-side Trap Ledger writer for activity events (A.3.a).
 *
 * Emits `mcp_call` events with `activity_name` discriminator and `session_id`
 * correlation when MCP tools fire. Reads the session ID from
 * `.totem/ledger/.session-id` (written by the SessionStart hook); when no
 * session ID is present, the event is still emitted without one — the
 * compliance metric (A.3.b) will treat hookless sessions via the rolling-2h
 * fallback per ADR-029 § Session Heuristic.
 *
 * `agent_source` is intentionally left undefined here — the MCP server does
 * not currently know which orchestrator is calling. A.3.c (correlation IDs
 * end-to-end) wires the orchestrator → MCP attribution propagation.
 *
 * All writes are fire-and-forget: a ledger failure must NEVER break the tool
 * call. Telemetry is a sensor, not an actuator (lesson-b1bae311).
 */

import * as path from 'node:path';

import type { LedgerEvent } from '@mmnto/totem';
import { appendLedgerEvent, readSessionId } from '@mmnto/totem';

import { getContext } from './context.js';

/**
 * Emit a single `mcp_call` ledger event for the given activity.
 *
 * Fire-and-forget on any internal failure (config load, fs write, etc.) —
 * production tool calls must not fail because telemetry could not be written.
 *
 * @param activityName Discriminator within the `mcp_call` family
 *   (`search_knowledge`, `describe_project`, `add_lesson`, `verify_execution`).
 */
export async function logMcpCall(activityName: string): Promise<void> {
  try {
    const { projectRoot, config } = await getContext();
    const totemDir = path.join(projectRoot, config.totemDir);
    const sessionId = readSessionId(totemDir);

    const event: LedgerEvent = {
      timestamp: new Date().toISOString(),
      type: 'mcp_call',
      activity_name: activityName,
      source: 'bot',
      justification: '',
      ...(sessionId !== undefined && { session_id: sessionId }),
    };

    appendLedgerEvent(totemDir, event);
  } catch {
    // Fire-and-forget: telemetry failure must not break tool calls.
  }
}
