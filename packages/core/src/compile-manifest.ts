import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { getErrorMessage, TotemParseError } from './errors.js';
import { readJsonSafe } from './sys/fs.js';

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
 * Deterministic JSON stringify. Walks the input tree and sorts every
 * object's keys alphabetically before serialising. Arrays keep their
 * element order (arrays are ordered by contract). Primitives and
 * `null` pass through unchanged.
 *
 * Used by `generateOutputHash` so that a compound ast-grep rule
 * (`astGrepYamlRule`) produces the same output hash regardless of the
 * JS engine's property insertion order. Without this, two compile
 * runs could emit functionally-identical rules with different key
 * orders and trip `verify-manifest` on an otherwise stable lesson
 * set. The invariant is: structurally-equivalent inputs produce
 * byte-identical outputs.
 *
 * **Contract:** `value` MUST be plain JSON — the output of
 * `JSON.parse()` or a literal composed of `null`, booleans, numbers,
 * strings, arrays, and plain object literals. Class instances
 * (`Date`, `Map`, custom classes) are not supported and may produce
 * output that diverges from `JSON.stringify`: a `Date` serialises to
 * `{}` rather than its ISO string, `[undefined]` throws rather than
 * becoming `[null]`. Callers in Totem always pass `JSON.parse()`
 * output, so these cases are unreachable in practice; the contract
 * is documented here so future callers do not reach for this
 * function as a drop-in `JSON.stringify` replacement.
 *
 * Design notes:
 *   - No cycle detection. Input is expected to be a finite tree
 *     (NapiConfig + primitive scalars). Cyclic input would stack
 *     overflow; that is a hard error, not a silent degradation.
 *   - Undefined values inside records are dropped, matching
 *     `JSON.stringify` parity. A bare `undefined` throws — it is
 *     not a JSON value.
 */
/**
 * Detect whether a parsed compiled-rules file contains at least one
 * rule with an `astGrepYamlRule` field. Walks only the `rules` array
 * on the top-level object; does not recurse into nested rule bodies
 * because compound rules live exactly one level deep in the payload.
 */
function hasCompoundRule(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const rules = (parsed as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) return false;
  for (const r of rules) {
    if (r && typeof r === 'object' && 'astGrepYamlRule' in r) return true;
  }
  return false;
}

export function canonicalStringify(value: unknown): string {
  if (value === undefined) {
    throw new TotemParseError(
      'canonicalStringify: undefined is not a JSON value',
      'The manifest hash payload must be JSON-parseable. Undefined entries are filtered out of records before serialisation, so a direct undefined here indicates a caller bug rather than malformed data on disk.',
    );
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalStringify(v)).join(',') + ']';
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  const parts: string[] = [];
  for (const k of keys) {
    parts.push(JSON.stringify(k) + ':' + canonicalStringify(record[k]));
  }
  return '{' + parts.join(',') + '}';
}

/**
 * Generate a deterministic SHA-256 hash of the compiled rules file.
 *
 * Line endings are normalized to `\n` before hashing. For files that
 * contain at least one compound `astGrepYamlRule`, the payload is
 * re-serialised through `canonicalStringify` so key-order variation
 * inside the yaml object cannot shift the hash (mmnto/totem#1407).
 * Files without any compound rule keep the byte-stream path for
 * backward compatibility with manifests written by pre-#1407 CLIs:
 * the old and new computation match byte-for-byte in that case, so
 * every user's existing compile-manifest.json stays valid after
 * upgrading without a forced recompile.
 *
 * A parse failure falls back to the raw content so verify-manifest
 * can still catch tampering on partial writes; it does not mask the
 * error.
 */
export function generateOutputHash(rulesPath: string): string {
  try {
    const raw = fs.readFileSync(rulesPath, 'utf-8').replace(/\r\n/g, '\n');
    let payload = raw;
    // Only switch to canonical serialization when the file actually
    // contains a compound rule. We parse first and check the real
    // field on every rule rather than substring-matching the raw
    // bytes: a lesson message or heading could contain the literal
    // string `"astGrepYamlRule"` and falsely flip the path,
    // producing a different hash than pre-#1407 CLIs computed for
    // the same manifest. Parsing is O(file size), same as hashing.
    if (raw.includes('"astGrepYamlRule"')) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (hasCompoundRule(parsed)) {
          payload = canonicalStringify(parsed);
        }
      } catch {
        // Malformed JSON: keep the raw byte stream so verify-manifest
        // still surfaces the corruption via a mismatch rather than
        // crashing here.
      }
    }
    return crypto.createHash('sha256').update(payload).digest('hex');
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
  try {
    return readJsonSafe(manifestPath, CompileManifestSchema);
  } catch (err) {
    if (!(err instanceof TotemParseError)) throw err;
    // Re-throw with manifest-specific recovery hints
    if (err.message.includes('File not found')) {
      throw new TotemParseError(
        `Compile manifest not found: ${manifestPath}`,
        'Run "totem compile" to generate the manifest.',
        err.cause,
      );
    }
    if (err.message.includes('Invalid JSON')) {
      throw new TotemParseError(
        `Invalid JSON in compile manifest: ${manifestPath}`,
        'The manifest file is corrupted. Re-run "totem compile".',
        err.cause,
      );
    }
    if (err.message.includes('Schema validation failed')) {
      throw new TotemParseError(
        `Invalid compile manifest schema: ${err.message.replace('[Totem Error] ', '')}`,
        'The manifest file has an unexpected structure. Re-run "totem compile".',
        err.cause,
      );
    }
    throw err;
  }
}
