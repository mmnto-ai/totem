import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import { TotemParseError } from './errors.js';
import { acquireLock } from './lock.js';
import { readJsonSafe } from './sys/fs.js';

export const RegistryEntrySchema = z
  .object({
    path: z.string(),
    chunkCount: z.number(),
    lastSync: z.string(),
    embedder: z.string(),
  })
  .passthrough(); // Preserve unknown fields from newer CLI versions

export const RegistrySchema = z.record(z.string(), RegistryEntrySchema);
export type TotemRegistry = z.infer<typeof RegistrySchema>;
export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;

/** Resolve the registry directory lazily so tests can mock os.homedir(). */
function registryDir(): string {
  return path.join(os.homedir(), '.totem');
}

/** Resolve the registry file path lazily so tests can mock os.homedir(). */
function registryPath(): string {
  return path.join(registryDir(), 'registry.json');
}

export function readRegistry(onWarn?: (msg: string) => void): TotemRegistry {
  try {
    return readJsonSafe(registryPath(), RegistrySchema);
  } catch (err) {
    if (err instanceof TotemParseError && err.message.includes('File not found')) {
      // Expected on first run — silently return empty
      return {};
    }
    onWarn?.(
      `Cannot read registry: ${err instanceof Error ? err.message : String(err)} — using empty registry`,
    );
    return {};
  }
}

/**
 * Update a single entry in the global registry.
 * Uses file locking to prevent concurrent sync processes from clobbering each other.
 */
export async function updateRegistryEntry(entry: RegistryEntry): Promise<void> {
  const dir = registryDir();
  const filePath = registryPath();
  fs.mkdirSync(dir, { recursive: true });

  // Acquire lock to prevent TOCTOU races from concurrent syncs
  const release = await acquireLock(dir);
  try {
    // If the file exists but can't be read/parsed, throw to prevent silent data loss.
    // The caller (sync.ts) wraps this in try/catch and logs the warning.
    let registry: TotemRegistry = {};
    if (fs.existsSync(filePath)) {
      try {
        registry = readJsonSafe(filePath, RegistrySchema);
      } catch (err) {
        if (err instanceof TotemParseError && err.message.includes('Schema validation failed')) {
          throw new TotemParseError(
            'Registry file has invalid schema — refusing to overwrite.',
            'Delete ~/.totem/registry.json to reset.',
            err.cause,
          );
        }
        throw err;
      }
    }

    registry[entry.path] = entry;
    // PID-unique temp file prevents collision on write
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2) + '\n');
    fs.renameSync(tmpPath, filePath);
  } finally {
    release();
  }
}
