import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ExemptionLocal, ExemptionShared } from './exemption-schema.js';
import {
  EMPTY_LOCAL,
  EMPTY_SHARED,
  ExemptionLocalSchema,
  ExemptionSharedSchema,
  LOCAL_FILE,
  SHARED_FILE,
} from './exemption-schema.js';

/**
 * Read local exemption tracking state from .totem/cache/exemption-local.json.
 * Returns EMPTY_LOCAL if missing, corrupt, or unreadable.
 */
export function readLocalExemptions(
  cacheDir: string,
  onWarn?: (msg: string) => void,
): ExemptionLocal {
  const filePath = path.join(cacheDir, LOCAL_FILE);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const result = ExemptionLocalSchema.safeParse(parsed);
    if (result.success) return result.data;
    onWarn?.(`Corrupt exemption-local.json — resetting to empty state`);
    return { ...EMPTY_LOCAL };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      const msg = err instanceof Error ? err.message : String(err);
      onWarn?.(`Failed to read exemption-local.json: ${msg}`);
    }
    return { ...EMPTY_LOCAL };
  }
}

/**
 * Write local exemption tracking state.
 * Creates cache directory if needed. Fire-and-forget on failure.
 */
export function writeLocalExemptions(
  cacheDir: string,
  data: ExemptionLocal,
  onWarn?: (msg: string) => void,
): void {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    const filePath = path.join(cacheDir, LOCAL_FILE);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onWarn?.(`Failed to write exemption-local.json: ${msg}`);
  }
}

/**
 * Read shared exemptions from .totem/exemptions.json (committed, team-wide).
 * Returns EMPTY_SHARED if missing or invalid.
 */
export function readSharedExemptions(
  totemDir: string,
  onWarn?: (msg: string) => void,
): ExemptionShared {
  const filePath = path.join(totemDir, SHARED_FILE);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const result = ExemptionSharedSchema.safeParse(parsed);
    if (result.success) return result.data;
    onWarn?.(`Corrupt exemptions.json — treating as empty`);
    return { ...EMPTY_SHARED };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      const msg = err instanceof Error ? err.message : String(err);
      onWarn?.(`Failed to read exemptions.json: ${msg}`);
    }
    return { ...EMPTY_SHARED };
  }
}

/**
 * Write shared exemptions file.
 * Creates directory if needed. Fire-and-forget on failure.
 */
export function writeSharedExemptions(
  totemDir: string,
  data: ExemptionShared,
  onWarn?: (msg: string) => void,
): void {
  try {
    fs.mkdirSync(totemDir, { recursive: true });
    const filePath = path.join(totemDir, SHARED_FILE);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onWarn?.(`Failed to write exemptions.json: ${msg}`);
  }
}
