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

import type { LedgerEvent, SelectionCandidate, SelectionContextKey } from '@mmnto/totem';
import {
  appendLedgerEvent,
  readSessionId,
  senseCorpusQuery,
  senseSelectionManifest,
} from '@mmnto/totem';

import { getContext } from './context.js';
import { logSearch } from './search-log.js';

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
  // A ledger write failure must NEVER break the MCP tool call. Telemetry is
  // a sensor (lesson-b1bae311); failure to record an event corrupts
  // compliance metrics, not the tool call's downstream behavior. The outer
  // .catch() at the call site provides defense-in-depth against any
  // synchronous throw between awaits.
  // totem-context: fire-and-forget telemetry; failure must not propagate
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
    // totem-context: fire-and-forget telemetry; failure must not propagate
  } catch (err) {
    // intentional swallow — telemetry is a sensor (lesson-b1bae311),
    // failure to record an mcp_call event must not crash the MCP server.
    void err;
  }
}

/**
 * Emit the query-before-derive `corpus_query` row for a `search_knowledge` call
 * (mmnto-ai/totem#2510).
 *
 * Deliberately NOT called from `logMcpCall`. That fires at handler entry —
 * before the first-query health gate and before the search itself — so folding
 * this into it would mint a groundable correlation ID for a search that was
 * blocked on a dimension mismatch or that threw, letting a later derive claim
 * grounding from a query that returned nothing. That inverts the rule the CLI
 * seam follows ("a query that threw grounded nothing"), so the two surfaces are
 * decoupled: `mcp_call` stays at entry and keeps feeding ADR-029 untouched,
 * while this is called only once the search has actually run.
 *
 * Zero hits still counts — the query RAN, and the agent saw its result. The
 * distinction is "did a corpus query execute", not "did it find something".
 */
/**
 * Emit the `search_knowledge` selection manifest (mmnto-ai/totem#2468 M1).
 *
 * Pure sensor: called only after a search actually produced a selection
 * outcome (the same "did it run" boundary `logCorpusQuery` draws — isError
 * outages emit nothing; the `mcp_call` denominator row makes that absence a
 * recorded one, never a silent skip). Failures surface through the search log
 * under the `internal:` idiom — this package speaks MCP over stdio, so
 * stderr/stdout are off-limits by styleguide.
 */
export async function logSelectionManifest(input: {
  context: Partial<Record<SelectionContextKey, string | number | boolean | null>>;
  universe: string;
  candidates: SelectionCandidate[];
  warnings: string[];
}): Promise<void> {
  // totem-context: fire-and-forget telemetry; failure must not propagate
  try {
    const { projectRoot, config } = await getContext();
    const totemDir = path.join(projectRoot, config.totemDir);
    // Best-effort emitting-package version (leg round 1, N-13 — row parity
    // with the orient/hook emitters). `../package.json` resolves to
    // packages/mcp/package.json from BOTH src/ and dist/ layouts.
    let emitterVersion: string | undefined;
    try {
      const { createRequire } = await import('node:module');
      emitterVersion = (createRequire(import.meta.url)('../package.json') as { version?: string })
        .version;
      // totem-context: version is a best-effort enrichment of the manifest row; resolution failure must never cost the row (Tenet 13).
    } catch (err) {
      void err;
    }
    senseSelectionManifest(
      {
        totemDir,
        emitter: 'search_knowledge',
        context: input.context,
        universe: input.universe,
        candidates: input.candidates,
        warnings: input.warnings,
        ...(emitterVersion !== undefined && { cliVersion: emitterVersion }),
      },
      (msg) => {
        logSearch({
          timestamp: new Date().toISOString(),
          query: 'internal:selection-manifest',
          resultCount: 0,
          durationMs: 0,
          topScore: null,
          error: msg,
        });
      },
    );
    // totem-context: fire-and-forget telemetry; failure must not propagate
  } catch (err) {
    // intentional swallow — telemetry is a sensor (lesson-b1bae311); failing to
    // record a selection manifest must not crash the MCP server. The absence
    // stays recorded via the mcp_call denominator row (#2468 design).
    void err;
  }
}

export async function logCorpusQuery(): Promise<void> {
  // totem-context: fire-and-forget telemetry; failure must not propagate
  try {
    const { projectRoot, config } = await getContext();
    const totemDir = path.join(projectRoot, config.totemDir);
    senseCorpusQuery({ totemDir, source: 'bot', surface: 'search_knowledge' }, (msg) => {
      // NOT stderr. This package speaks MCP over stdio, so any direct stdout or
      // stderr write corrupts the transport — the styleguide bans them outright.
      // The visible accounting surface here is the search log on disk, using the
      // same `internal:` synthetic-entry idiom `search-knowledge.ts` already
      // uses to record its own set-log-dir failures. Visible, not swallowed.
      logSearch({
        timestamp: new Date().toISOString(),
        query: 'internal:qbd-corpus-query',
        resultCount: 0,
        durationMs: 0,
        topScore: null,
        error: msg,
      });
    });
    // totem-context: fire-and-forget telemetry; failure must not propagate
  } catch (err) {
    // intentional swallow — telemetry is a sensor (lesson-b1bae311); failing to
    // record a corpus_query row must not crash the MCP server.
    void err;
  }
}
