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

import { TotemError } from './errors.js';

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
  try {
    const ledgerDir = path.join(totemDir, LEDGER_DIR);
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.writeFileSync(path.join(ledgerDir, SESSION_ID_FILE), sessionId, 'utf-8');
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null ? (err as NodeJS.ErrnoException).code : undefined;
    const msg = err instanceof Error ? err.message : String(err);
    // Known fs failure classes are fire-and-forget — SessionStart must not
    // block on telemetry write (sensors-not-actuators per lesson-b1bae311).
    if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
      onWarn?.(`Session-ID write failed: ${msg}`);
      return;
    }
    // Unexpected error class — wrap with TotemError per styleguide cause-chains
    // rule (line 120). Tenet 4 Fail Loud satisfied via .cause chain.
    throw new TotemError(
      'SESSION_ID_WRITE_FAILED',
      'Unexpected error writing session ID',
      'Check filesystem permissions for the .totem/ledger directory.',
      err,
    );
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
 *
 * Race-condition note (strategy-Claude T0345Z): if a ledger writer reads this
 * file mid-SessionStart-hook rotation, it will stamp the event with the prior
 * session UUID. This is intentional and NOT a bug — the event's timestamp
 * reflects when it actually fired, and the ADR-029 compliance metric considers
 * it part of the prior session (correctly, per its temporal semantics). Future
 * readers tempted to "fix" this race by guarding rotation with a lockfile
 * should re-read this doc-comment and the metric semantics before changing.
 */
export function readSessionId(totemDir: string, ttlHours = DEFAULT_TTL_HOURS): string | undefined {
  const filePath = path.join(totemDir, LEDGER_DIR, SESSION_ID_FILE);
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
    const code =
      typeof err === 'object' && err !== null ? (err as NodeJS.ErrnoException).code : undefined;
    // Missing/unreadable .session-id is a normal state (pre-hook session,
    // hookless agent, stale file outside TTL). Treat as "no session ID
    // available" — same downstream behavior as the TTL-expired branch.
    // EPERM + EROFS added for parity with writeSessionId's fs-failure-class
    // discrimination (CR + GCA Round-1 catch).
    if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
      return undefined;
    }
    // Unexpected error class — wrap with TotemError per styleguide cause-chains
    // rule (line 120). Tenet 4 Fail Loud satisfied via .cause chain.
    throw new TotemError(
      'SESSION_ID_READ_FAILED',
      'Unexpected error reading session ID',
      'Check filesystem permissions for the .totem/ledger/.session-id file.',
      err,
    );
  }
}
