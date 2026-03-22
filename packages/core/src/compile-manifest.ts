import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { TotemParseError } from './errors.js';

// ─── Schema ──────────────────────────────────────────

export const CompileManifestSchema = z.object({
  compiled_at: z.string(),
  model: z.string(),
  input_hash: z.string(),
  output_hash: z.string(),
  rule_count: z.number().int().nonnegative(),
});

export type CompileManifest = z.infer<typeof CompileManifestSchema>;

// ─── Hashing ─────────────────────────────────────────

/**
 * Walk a directory recursively and collect all `.md` file paths
 * relative to `baseDir`, sorted alphabetically.
 */
function collectMdFiles(baseDir: string, currentDir: string = baseDir): string[] {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMdFiles(baseDir, fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'));
    }
  }

  return results;
}

/**
 * Generate a deterministic SHA-256 hash of all `.md` lesson files in a directory.
 *
 * Files are discovered recursively, sorted alphabetically by relative path,
 * and line endings are normalized to `\n` before hashing.
 */
export function generateInputHash(lessonsDir: string): string {
  const files = collectMdFiles(lessonsDir).sort();
  const hash = crypto.createHash('sha256');

  for (const relPath of files) {
    const content = fs.readFileSync(path.join(lessonsDir, relPath), 'utf-8').replace(/\r\n/g, '\n');
    hash.update(`${relPath}\n${content}\n`);
  }

  return hash.digest('hex');
}

/**
 * Generate a deterministic SHA-256 hash of the compiled rules file.
 *
 * Line endings are normalized to `\n` before hashing.
 */
export function generateOutputHash(rulesPath: string): string {
  const content = fs.readFileSync(rulesPath, 'utf-8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(content).digest('hex');
}

// ─── I/O ─────────────────────────────────────────────

/**
 * Write a compile manifest to disk as pretty-printed JSON.
 */
export function writeCompileManifest(manifestPath: string, manifest: CompileManifest): void {
  const json = JSON.stringify(manifest, null, 2) + '\n';
  fs.writeFileSync(manifestPath, json, { encoding: 'utf-8', mode: 0o644 });
}

/**
 * Read and validate a compile manifest from disk.
 *
 * @throws {TotemParseError} if the file is missing or contains invalid JSON/schema.
 */
export function readCompileManifest(manifestPath: string): CompileManifest {
  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new TotemParseError(
        `Compile manifest not found: ${manifestPath}`,
        'Run "totem compile" to generate the manifest.',
      );
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TotemParseError(
      `Invalid JSON in compile manifest: ${manifestPath}`,
      'The manifest file is corrupted. Re-run "totem compile".',
    );
  }

  const result = CompileManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new TotemParseError(
      `Invalid compile manifest schema: ${result.error.message}`,
      'The manifest file has an unexpected structure. Re-run "totem compile".',
    );
  }

  return result.data;
}
