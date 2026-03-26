import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { getErrorMessage, TotemParseError } from './errors.js';

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
  if (!fs.existsSync(baseDir)) {
    throw new TotemParseError(
      `Lessons directory not found: ${baseDir}`,
      'Run "totem sync" or create .totem/lessons/ with lesson files.',
    );
  }
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
    try {
      const content = fs
        .readFileSync(path.join(lessonsDir, relPath), 'utf-8')
        .replace(/\r\n/g, '\n');
      hash.update(`${relPath}\n${content}\n`);
    } catch (err) {
      throw new TotemParseError(
        `Cannot read lesson file ${relPath}: ${getErrorMessage(err)}`,
        'Ensure all lesson files in .totem/lessons/ are readable.',
        err,
      );
    }
  }

  return hash.digest('hex');
}

/**
 * Generate a deterministic SHA-256 hash of the compiled rules file.
 *
 * Line endings are normalized to `\n` before hashing.
 */
export function generateOutputHash(rulesPath: string): string {
  try {
    const content = fs.readFileSync(rulesPath, 'utf-8').replace(/\r\n/g, '\n');
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new TotemParseError(
        `Cannot hash compiled rules: ${rulesPath} not found`,
        'Run "totem compile" to generate compiled-rules.json.',
        err,
      );
    }
    throw new TotemParseError(
      `Cannot read compiled rules: ${getErrorMessage(err)}`,
      `Check file permissions for ${rulesPath}.`,
      err,
    );
  }
}

// ─── I/O ─────────────────────────────────────────────

const FILE_MODE = 0o644;

/**
 * Write a compile manifest to disk as pretty-printed JSON.
 */
export function writeCompileManifest(manifestPath: string, manifest: CompileManifest): void {
  const json = JSON.stringify(manifest, null, 2) + '\n';
  try {
    fs.writeFileSync(manifestPath, json, { encoding: 'utf-8', mode: FILE_MODE });
  } catch (err) {
    throw new TotemParseError(
      `Cannot write compile manifest: ${getErrorMessage(err)}`,
      `Check write permissions for ${manifestPath}.`,
      err,
    );
  }
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
        err,
      );
    }
    throw new TotemParseError(
      `Cannot read compile manifest: ${getErrorMessage(err)}`,
      `Check file permissions for ${manifestPath}.`,
      err,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new TotemParseError(
      `Invalid JSON in compile manifest: ${manifestPath} (${getErrorMessage(err)})`,
      'The manifest file is corrupted. Re-run "totem compile".',
      err,
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
