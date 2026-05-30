import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { TotemConfigError } from './errors.js';

export const FREEZE_FILE = 'freeze.json';

const FreezeEntrySchema = z.object({
  subsystem: z.string().min(1, 'subsystem must be a non-empty string'),
  since: z.string().optional(),
  reason: z.string().optional(),
  tracking: z.string().optional(),
  'do-not': z.array(z.string()).optional(),
});

const FreezeConfigSchema = z.object({
  _note: z.string().optional(),
  frozen: z.array(FreezeEntrySchema),
});

export type FreezeEntry = z.infer<typeof FreezeEntrySchema>;
export type FreezeConfig = z.infer<typeof FreezeConfigSchema>;

/**
 * Read `<totemDir>/freeze.json`, the WS1 freeze primitive.
 *
 * - **Absent file → `null`.** Absence means "nothing is frozen" — the only
 *   allow-on-absence in the gate layer, and semantically correct.
 * - **Present but unparseable/invalid → THROWS `TotemConfigError` (fail-closed).**
 *   A corrupt freeze file must never silently bypass itself (Tenet 4).
 *
 * This deliberately diverges from the graceful (warn-and-continue) ledger reader:
 * a gate's deterministic input failing to parse is a hard error, not a shrug.
 */
export function readFreezeConfig(totemDir: string): FreezeConfig | null {
  const filePath = path.join(totemDir, FREEZE_FILE);

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new TotemConfigError(
      `Failed to read ${FREEZE_FILE}`,
      'Check filesystem permissions for the .totem directory.',
      'CONFIG_MISSING',
      err,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new TotemConfigError(
      `Malformed ${FREEZE_FILE}`,
      'Fix the JSON syntax in .totem/freeze.json, or remove the file if nothing is frozen.',
      'CONFIG_INVALID',
      err,
    );
  }

  const result = FreezeConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new TotemConfigError(
      `Invalid ${FREEZE_FILE}: ${result.error.issues.map((i) => i.message).join('; ')}`,
      'freeze.json must be { frozen: [{ subsystem, since?, reason?, tracking?, "do-not"? }] }.',
      'CONFIG_INVALID',
      result.error,
    );
  }

  return result.data;
}
