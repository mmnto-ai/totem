import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { getErrorMessage, TotemParseError } from './errors.js';
import { readJsonSafe } from './sys/fs.js';
import { listTrackedFilesUnder } from './sys/git.js';

// ─── Schema ──────────────────────────────────────────

export const CompileManifestSchema = z.object({
  compiled_at: z.string(),
  model: z.string(),
  input_hash: z.string(),
  output_hash: z.string(),
  rule_count: z.number().int().nonnegative(),
  // Producer attestation orthogonal to output_hash (recompute trigger).
  // Optional for backward-compat with pre-#1937 manifests; only the anthropic
  // provider populates it in Phase 1. Per Proposal 278 § Action 3.
  compile_worker_fingerprint: z.string().optional(),
  /**
   * Prop 310 § Design 1 — the aggregate attestation over the RECORD file class
   * (`<totemDir>/rules/**\/*.rule.yaml`), computed by `generateRecordsHash`.
   *
   * OPTIONAL, per the slice-3 OQ-3 ruling: absence is legal IFF zero record files
   * exist on disk (the state every pre-Prop-310 manifest is in), so no shipped
   * manifest needs a hand-edit and downstream manifests keep verifying. The first
   * record landing forces attestation — `verify-manifest` hard-FAILS on records
   * present with no `records_hash` ("unattested file class"), and hard-FAILS on a
   * mismatch. Neither ever takes the freeze WARN-downgrade, which is input-hash-only.
   */
  records_hash: z.string().optional(),
});

export type CompileManifest = z.infer<typeof CompileManifestSchema>;

// ─── Hashing ─────────────────────────────────────────

/**
 * Walk a directory recursively and collect every file path ending in `suffix`,
 * relative to `baseDir`, '/'-separated. UNSORTED (callers sort).
 *
 * Generalised from the `.md`-only walk by Prop 310 slice 3 so the record file
 * class (`*.rule.yaml`) is attested by the SAME collector the lesson class uses —
 * a second walk would be the mirror that silently drifts on the next fix. The
 * missing-directory throw is the lesson class's contract and is kept exactly:
 * `collectMdFiles` is the thin wrapper below, so `generateInputHash` is unchanged.
 */
function collectFilesWithSuffix(
  baseDir: string,
  suffix: string,
  currentDir: string = baseDir,
): string[] {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFilesWithSuffix(baseDir, suffix, fullPath));
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      results.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'));
    }
  }

  return results;
}

/**
 * Walk a directory recursively and collect all `.md` file paths
 * relative to `baseDir`, sorted alphabetically.
 */
function collectMdFiles(baseDir: string): string[] {
  if (!fs.existsSync(baseDir)) {
    throw new TotemParseError(
      `Lessons directory not found: ${baseDir}`,
      'Run "totem sync" or create .totem/lessons/ with lesson files.',
    );
  }
  return collectFilesWithSuffix(baseDir, '.md');
}

/**
 * Restrict a collected relative-path list to the git-tracked subset when
 * `repoCwd` resolves inside a git repository; outside one (or when git is
 * unavailable) the list passes through unchanged.
 *
 * Single-homed across both hashed file classes so lessons and records can never
 * disagree about what "tracked" means (see `generateInputHash`'s own note for
 * why tracked-only is the producer/consumer-symmetric answer).
 */
function restrictToTracked(
  files: string[],
  baseDir: string,
  repoCwd: string | undefined,
): string[] {
  if (repoCwd === undefined) return files;
  const tracked = listTrackedFilesUnder(repoCwd, baseDir);
  if (tracked === null) return files;
  // Both collectors and `listTrackedFilesUnder` emit '/'-separated paths, so the
  // membership test already agrees cross-platform. Normalize the comparison key
  // anyway so this filter never silently depends on a distant function preserving
  // that invariant — a no-op on forward-slash input.
  return files.filter((relPath) => tracked.has(relPath.replace(/\\/g, '/')));
}

/**
 * Roll a deterministic sha256 over `${relPath}\n${lfContent}\n` for each file, in
 * the given order. The one hashing method both attested file classes use.
 */
function rollingContentHash(
  baseDir: string,
  files: readonly string[],
  onReadError: (relPath: string, err: unknown) => never,
): string {
  const hash = crypto.createHash('sha256');
  for (const relPath of files) {
    try {
      const content = fs.readFileSync(path.join(baseDir, relPath), 'utf-8').replace(/\r\n/g, '\n');
      hash.update(`${relPath}\n${content}\n`);
    } catch (err) {
      // `throw`n, not merely called: `onReadError` returns `never`, and writing the
      // throw here keeps this catch visibly non-swallowing (Tenet 4) instead of
      // hiding the rethrow behind a callback.
      throw onReadError(relPath, err);
    }
  }
  return hash.digest('hex');
}

/**
 * Generate a deterministic SHA-256 hash of `.md` lesson files in a directory.
 *
 * Files are discovered recursively, sorted alphabetically by relative path,
 * and line endings are normalized to `\n` before hashing.
 *
 * When `repoCwd` is supplied and resolves inside a git repository, only
 * **git-tracked** lessons are hashed — untracked working-tree lessons (e.g. an
 * MCP `add_lesson`/`extract` scratch file) are excluded so they cannot diverge
 * the hash and block an unrelated push (mmnto-ai/totem#2051 / #2055
 * working-tree-scope class). The producer (`totem compile`) runs on a clean
 * tree, so the hash it records already equals the tracked-only hash; checkers
 * (`verify-manifest`, `lint`, `status`) pass `repoCwd` to stay symmetric
 * without forcing a recompile. Outside a git repo, or when git is unavailable,
 * the function falls back to hashing every `.md` (the legacy/pure behavior) —
 * so the default no-arg form is byte-for-byte unchanged.
 */
export function generateInputHash(lessonsDir: string, repoCwd?: string): string {
  const files = restrictToTracked(collectMdFiles(lessonsDir).sort(), lessonsDir, repoCwd);
  return rollingContentHash(lessonsDir, files, (relPath, err) => {
    throw new TotemParseError(
      `Cannot read lesson file ${relPath}: ${getErrorMessage(err)}`,
      'Ensure all lesson files in .totem/lessons/ are readable.',
      err,
    );
  });
}

// ─── Prop 310 § Design 1 — the RECORD file class ─────────────────────────────

/** `.totem`-relative directory the Prop 310 rule records live in (§ Design 1). */
export const RECORDS_DIR_REL = 'rules';

/** The double extension § Design 1 rules: `*.rule.yaml`, never a bare `*.yaml`. */
export const RECORD_FILE_SUFFIX = '.rule.yaml';

/**
 * The `records_hash` of an EMPTY record set — sha256 over nothing, the value
 * `generateRecordsHash` returns when `<totemDir>/rules/` is absent or holds no
 * `*.rule.yaml`. COMPUTED, never a transcribed literal: a hand-copied digest is a
 * mirror that can be typo'd, and this constant is what the OQ-3 "records: none"
 * verdict and the cross-platform stability test both bind to.
 */
export const EMPTY_RECORDS_HASH = crypto.createHash('sha256').digest('hex');

/**
 * Enumerate the record files under `rulesDir`, sorted, '/'-separated, restricted
 * to the git-tracked set when `repoCwd` resolves inside a repo (the same
 * producer/consumer symmetry `generateInputHash` documents). Returns `[]` when the
 * directory does not exist — an absent record class is the pre-Prop-310 state, not
 * an error, which is the one place this differs from the lesson class.
 *
 * Exported because `verify-manifest` needs the COUNT, not the hash, to decide the
 * OQ-3 verdict ("absent `records_hash` is OK iff zero records on disk"): deciding
 * it by comparing against `EMPTY_RECORDS_HASH` would infer a file count from a
 * digest instead of asking the disk.
 */
export function listRecordFiles(rulesDir: string, repoCwd?: string): string[] {
  if (!fs.existsSync(rulesDir)) return [];
  return restrictToTracked(
    collectFilesWithSuffix(rulesDir, RECORD_FILE_SUFFIX).sort(),
    rulesDir,
    repoCwd,
  );
}

/**
 * Generate the deterministic sha256 attestation over the Prop 310 record file
 * class — the same rolling `${relPath}\n${lfContent}\n` method `generateInputHash`
 * uses over lessons, so the two attestations are path-AND-content sensitive in
 * exactly the same way: one edited byte, one added, removed, or renamed record all
 * move it. Absent directory ⇒ `EMPTY_RECORDS_HASH`.
 */
export function generateRecordsHash(rulesDir: string, repoCwd?: string): string {
  return rollingContentHash(rulesDir, listRecordFiles(rulesDir, repoCwd), (relPath, err) => {
    throw new TotemParseError(
      `Cannot read rule record ${relPath}: ${getErrorMessage(err)}`,
      `Ensure all record files in ${RECORDS_DIR_REL}/ are readable.`,
      err,
    );
  });
}

/**
 * The ONE call every `writeCompileManifest` caller makes to attest the record
 * class, given the `.totem` directory. Single-homed so six writer sites cannot
 * disagree about where records live or how they are hashed (Tenet 20).
 */
export function attestRecordsHash(totemDir: string, repoCwd?: string): string {
  return generateRecordsHash(path.join(totemDir, RECORDS_DIR_REL), repoCwd);
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

/**
 * Recursively shape an object tree so every nested record's keys are sorted
 * lexicographically and `undefined` properties are dropped. Pure data
 * transform — caller chooses how to serialize the result (minified for hash
 * payloads, pretty-printed for committable files).
 */
export function canonicalizeKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalizeKeys);
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(record).sort()) {
    if (record[k] === undefined) continue;
    out[k] = canonicalizeKeys(record[k]);
  }
  return out;
}

/**
 * Stringify a value with deterministic key order. The 1-arg form returns
 * minified JSON (the manifest-hash payload form per mmnto/totem#1407). Pass
 * `indent` to produce pretty-printed canonical JSON (used for committable
 * artefacts like `.totem/verification-outcomes.json` per mmnto-ai/totem#1684).
 */
export function canonicalStringify(value: unknown, indent?: number): string {
  if (value === undefined) {
    throw new TotemParseError(
      'canonicalStringify: undefined is not a JSON value',
      'The manifest hash payload must be JSON-parseable. Undefined entries are filtered out of records before serialisation, so a direct undefined here indicates a caller bug rather than malformed data on disk.',
    );
  }
  if (indent !== undefined) {
    return JSON.stringify(canonicalizeKeys(value), null, indent);
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
