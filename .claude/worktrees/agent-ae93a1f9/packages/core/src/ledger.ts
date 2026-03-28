import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

// ─── Schema ─────────────────────────────────────────

export const LedgerEventSchema = z.object({
  /** ISO 8601 timestamp */
  timestamp: z.string().datetime(),
  /** Event type */
  type: z.enum(['suppress', 'override']),
  /** Rule ID (lessonHash) that was suppressed/overridden */
  ruleId: z.string().min(1),
  /** File where the suppression/override occurred */
  file: z.string().min(1),
  /** Line number in the file */
  line: z.number().int().positive().optional(),
  /** The justification text from totem-context: or shield-context: (empty for totem-ignore) */
  justification: z.string().default(''),
  /** Source of the event */
  source: z.enum(['lint', 'shield']),
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
