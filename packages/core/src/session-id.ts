/**
 * Session ID utilities for the Trap Ledger A.3.a schema extension.
 *
 * The SessionStart hook mints a UUID and persists it to `.totem/ledger/.session-id`.
 * Subsequent MCP calls and ledger writes within the same session correlate via this
 * UUID. Per ADR-029 § Session Heuristic, the explicit UUID supersedes the rolling-2h
 * activity-based heuristic when present; the TTL fallback handles long-running
 * sessions exceeding 24h or sessions that bypass the SessionStart hook.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SESSION_ID_FILE = '.session-id';
const LEDGER_DIR = 'ledger';
const DEFAULT_TTL_HOURS = 24;

/** Mint a fresh session UUID. */
export function mintSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Persist a session ID to `<totemDir>/ledger/.session-id`.
 * Creates the ledger directory if it doesn't exist. Fire-and-forget on I/O failure.
 */
export function writeSessionId(
  totemDir: string,
  sessionId: string,
  onWarn?: (msg: string) => void,
): void {
  // totem-context: fire-and-forget telemetry write — failures are surfaced
  // via onWarn but must not crash the SessionStart hook or block the
  // briefing path. Sensors-not-actuators per lesson-b1bae311.
  try {
    const ledgerDir = path.join(totemDir, LEDGER_DIR);
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.writeFileSync(path.join(ledgerDir, SESSION_ID_FILE), sessionId, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onWarn?.(`Session-ID write failed: ${msg}`);
  }
}

/**
 * Read the current session ID from `<totemDir>/ledger/.session-id`.
 *
 * Returns the persisted UUID when present AND within the TTL window. Returns
 * undefined when the file is missing, malformed, or expired (file older than
 * `ttlHours` per Q-9 — fallback for long sessions or hookless agents).
 *
 * The TTL fallback uses file mtime; sessions exceeding the window are treated
 * as "missing" so callers can defensively decide whether to rotate.
 */
export function readSessionId(totemDir: string, ttlHours = DEFAULT_TTL_HOURS): string | undefined {
  const filePath = path.join(totemDir, LEDGER_DIR, SESSION_ID_FILE);
  // totem-context: missing/unreadable .session-id is a normal state (pre-hook
  // session, hookless agent, stale file outside TTL). The caller distinguishes
  // "undefined session" from "I/O failure" by treating both as "no session
  // ID available" — same downstream behavior, no value in propagating the
  // error class. Sensors-not-actuators per lesson-b1bae311.
  try {
    const stat = fs.statSync(filePath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > ttlHours * 60 * 60 * 1000) return undefined;
    const contents = fs.readFileSync(filePath, 'utf-8').trim();
    // Validate UUID shape — defensive against partial writes or hand-edits.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contents)) {
      return undefined;
    }
    return contents;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    return undefined;
  }
}
