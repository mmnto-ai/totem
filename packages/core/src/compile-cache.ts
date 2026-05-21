/**
 * Per-lesson compile cache (Proposal 281 — Per-Lesson Hash Stability).
 *
 * Short-circuits `totem lesson compile` for lessons whose source content is
 * unchanged across compile runs. Eliminates the per-lesson hash rotation on
 * unrelated lessons when a single lesson is added or modified.
 *
 * Cache key is layered (not composite):
 *   1. `stableId` (when present — reserved for P280; P281 never writes it)
 *   2. `sourceHash` — sha256 of normalized lesson source content
 *   3. `fingerprint` — compile_worker_fingerprint from Proposal 278; mismatch
 *      invalidates the entry (e.g., model bump rotates every entry once)
 *
 * `cli_version` is intentionally NOT part of the cache key — including it
 * would invalidate every cohort bump, defeating the purpose. Per the impl
 * contract § Cache key composition.
 *
 * Storage: `.totem/cache/compile-lesson/<sourceHash-first-16-chars>.json`,
 * one entry per file, flat directory for v1 (see follow-on for fan-out
 * cutover at ~1000 lessons).
 *
 * Emergency escape: set `TOTEM_DISABLE_COMPILE_CACHE=1` to bypass the
 * cache entirely (lookup always returns null; write becomes a no-op).
 * Emergency only — not a long-term flag.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import type { CompileLessonResult } from './compile-lesson.js';

// ─── Constants ──────────────────────────────────────

// CACHE_DIR is resolved relative to `totemDir` (the already-configured
// `.totem` location). Including `.totem` in this constant duplicated the
// prefix and landed cache files at `<totemDir>/.totem/cache/...` instead of
// `<totemDir>/cache/...`. Per CR R3 Major on `mmnto-ai/totem#1983`.
const CACHE_DIR = path.join('cache', 'compile-lesson');
const HASH_FILENAME_PREFIX_LENGTH = 16;
const DISABLE_ENV_VAR = 'TOTEM_DISABLE_COMPILE_CACHE';

// ─── Schema ─────────────────────────────────────────

/**
 * Validator for the `output` field. CompileLessonResult is a discriminated
 * union (status: 'compiled' | 'skipped' | 'failed' | 'noop'); each variant
 * carries required fields that downstream consumers dereference unconditionally
 * (e.g., the cache-hit path reads `result.rule` for compiled outputs and
 * `result.hash` / `result.reasonCode` for skipped outputs). A minimal
 * status-only schema would accept truncated cache files like
 * `{ output: { status: 'compiled' } }` and break the file's own "bad cache
 * entry → miss, not crash" contract on the next lookup.
 *
 * Per CR R3 Major on `mmnto-ai/totem#1983`: validate the required-per-variant
 * shape so structurally incomplete payloads are rejected upfront. `rule` is
 * `z.unknown()` to avoid coupling this module to the full `CompiledRule`
 * shape (changes to that schema must not invalidate every cohort's cache);
 * variant-required fields like `hash` and `reasonCode` are typed concretely
 * since they're the dereferences that would crash.
 */
const CompileLessonResultMinimalSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('compiled'),
      // `rule` MUST be a non-null object (the CompiledRule payload). z.unknown()
      // would accept missing fields too, which defeats the contract — a payload
      // like `{ status: 'compiled' }` would survive validation and crash the
      // cache-hit path on `result.rule` dereference. `z.record(z.unknown())`
      // requires an object without coupling to CompiledRule's exact shape.
      rule: z.record(z.unknown()),
    })
    .passthrough(),
  z
    .object({
      status: z.literal('skipped'),
      hash: z.string(),
      reasonCode: z.string(),
    })
    .passthrough(),
  z
    .object({
      status: z.literal('failed'),
    })
    .passthrough(),
  z
    .object({
      status: z.literal('noop'),
    })
    .passthrough(),
]);

/**
 * Cache entry for one lesson's compile output.
 *
 * `stableId` is reserved for P280 (Wind-Tunnel Decoupling). P281 does not
 * populate or query it. Reserving the slot from day one avoids a full cache
 * re-key event when P280 lands; with the reservation, P280's integration is
 * an additive lookup extension, not a refactor. Per
 * `mmnto-ai/totem-strategy#387` § Dependencies (load-bearing).
 */
export const CacheEntrySchema = z.object({
  sourceHash: z.string(),
  stableId: z.string().optional(),
  fingerprint: z.string(),
  output: CompileLessonResultMinimalSchema,
  compiledAt: z.string(),
});

export type CacheEntry = Omit<z.infer<typeof CacheEntrySchema>, 'output'> & {
  output: CompileLessonResult;
};

/**
 * Discrete cache decisions, emitted per lesson per compile run as
 * telemetry. Maps to the `compile_cache_decision` ledger event's
 * `activity_name` field.
 */
export type CacheDecision =
  | 'cache_hit'
  | 'cache_miss_source_changed'
  | 'cache_miss_fingerprint_changed'
  | 'cache_miss_force'
  | 'cache_miss_no_prior_record';

// ─── Public API ─────────────────────────────────────

/**
 * Compute the cache key for a lesson source. SHA-256 of the content with
 * line endings normalized to `\n` — same normalization as
 * `generateInputHash` in compile-manifest.ts so both surfaces produce
 * identical hashes for identical inputs.
 */
export function computeLessonSourceHash(lessonSource: string): string {
  // Normalization: collapse CRLF → LF ONLY. No trailing-whitespace trim — the
  // canonical `generateInputHash` (`compile-manifest.ts`) and `lessonHash` (per
  // `.gemini/styleguide.md` line 142) are both trailing-whitespace-sensitive.
  // Trimming here would desynchronize the cache key from the canonical hashes:
  // a whitespace-only edit would hit the cache (return stale lessonHash output)
  // while the manifest pipeline would compute a fresh lessonHash for the same
  // edit, breaking the deterministic link between lessons and rules.
  // Reverses an over-correction from R1; per GCA R2 critical on `#1983`.
  const normalized = lessonSource.replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Compose the hashable lesson source from a parsed lesson's heading and body.
 * Use this from any call site that has a parsed `LessonInput`-shaped object to
 * ensure runtime and migration paths produce identical hashes for the same
 * lesson. Without a shared composition helper, the runtime hash (computed from
 * `lesson.heading` + `lesson.body`) and a migration hash (computed from raw
 * file content with `## Lesson — ` framing) would diverge — exactly the bug
 * GCA R2 surfaced on `#1983`.
 */
export function composeLessonSourceForHash(heading: string, body: string): string {
  return `${heading}\n${body}`;
}

/**
 * Resolve the on-disk cache file path for a given source hash. Pure;
 * does not check existence. Callers handle missing files.
 */
export function cacheEntryPath(totemDir: string, sourceHash: string): string {
  const filename = `${sourceHash.slice(0, HASH_FILENAME_PREFIX_LENGTH)}.json`;
  return path.join(totemDir, CACHE_DIR, filename);
}

interface LookupResult {
  entry: CacheEntry | null;
  decision: CacheDecision;
}

/**
 * Look up a cache entry by `(sourceHash, fingerprint)`. Returns the entry
 * with `decision: 'cache_hit'` on a clean hit, or `null` with a
 * decision discriminating the miss reason.
 *
 * `stableId` parameter is reserved for P280 wiring — when present, the
 * lookup tries the stable-id-indexed entry first, falling back to
 * `sourceHash` on miss. v1 (this PR) never receives a non-undefined
 * value here.
 */
export function lookupCacheEntry(
  totemDir: string,
  sourceHash: string,
  fingerprint: string,
  options: { force?: boolean; stableId?: string } = {},
): LookupResult {
  if (options.force === true) {
    return { entry: null, decision: 'cache_miss_force' };
  }
  if (process.env[DISABLE_ENV_VAR] === '1') {
    // totem-context: intentional cleanup — emergency escape hatch reverts
    // cache to no-op without throwing.
    return { entry: null, decision: 'cache_miss_no_prior_record' };
  }

  const filePath = cacheEntryPath(totemDir, sourceHash);
  if (!fs.existsSync(filePath)) {
    return { entry: null, decision: 'cache_miss_no_prior_record' };
  }

  let raw: unknown;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    raw = JSON.parse(content);
    // totem-context: intentional cleanup — a bad cache entry must downgrade to a miss, never propagate; the cache is a side-channel optimization, not a load-bearing data path.
  } catch (err) {
    // totem-context: intentional cleanup — a bad cache entry must downgrade to a miss, never propagate; the cache is a side-channel optimization, not a load-bearing data path.
    void err;
    return { entry: null, decision: 'cache_miss_no_prior_record' };
  }

  const parsed = CacheEntrySchema.safeParse(raw);
  if (!parsed.success) {
    return { entry: null, decision: 'cache_miss_no_prior_record' };
  }

  // CacheEntrySchema validates the discriminator only; downstream casts back
  // to the rich CompileLessonResult union type. See COMPILE_LESSON_STATUS.
  const entry = parsed.data as CacheEntry;
  if (entry.sourceHash !== sourceHash) {
    // File was named by hash but its content disagrees — corrupted state,
    // treat as miss. Defensive against manual cache edits.
    return { entry: null, decision: 'cache_miss_source_changed' };
  }
  if (entry.fingerprint !== fingerprint) {
    return { entry: null, decision: 'cache_miss_fingerprint_changed' };
  }

  return { entry, decision: 'cache_hit' };
}

/**
 * Persist a cache entry after a successful compile. Idempotent — writing
 * the same `(sourceHash, fingerprint, output)` twice is a no-op-shaped
 * overwrite. Fire-and-forget: I/O failures are surfaced via `onWarn` and
 * never propagate (a failed cache write should not crash a compile).
 *
 * Returns `true` when the entry was successfully persisted, `false` on any
 * I/O failure or when the cache is disabled via env var. Callers that need
 * to track migration outcomes (e.g., `migrateFromCompiledRules`) inspect
 * the return; callers that don't care can ignore it.
 */
export function writeCacheEntry(
  totemDir: string,
  entry: CacheEntry,
  onWarn?: (msg: string) => void,
): boolean {
  if (process.env[DISABLE_ENV_VAR] === '1') {
    return false;
  }

  try {
    const filePath = cacheEntryPath(totemDir, entry.sourceHash);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2) + '\n', 'utf-8');
    return true;
    // totem-context: intentional cleanup — cache writes are fire-and-forget; a failed write degrades to "no cache entry exists" on next lookup, never blocks compile.
  } catch (err) {
    // totem-context: intentional cleanup — cache writes are fire-and-forget; a failed write degrades to "no cache entry exists" on next lookup, never blocks compile.
    const msg = err instanceof Error ? err.message : String(err);
    onWarn?.(`Compile cache write failed: ${msg}`);
    return false;
  }
}

/**
 * Construct a `CacheEntry` from the inputs of a fresh compile. Pure;
 * callers persist via `writeCacheEntry`.
 */
export function buildCacheEntry(
  sourceHash: string,
  fingerprint: string,
  output: CompileLessonResult,
): CacheEntry {
  return {
    sourceHash,
    fingerprint,
    output,
    compiledAt: new Date().toISOString(),
  };
}

interface MigrationSeedInput {
  /** Canonical lesson hash (rotation-prone). Carried for diagnostics only. */
  lessonHash: string;
  /**
   * Parsed lesson heading — the `## Lesson — …` heading-text minus the
   * leading `##` markdown. MUST match what `readAllLessons` (or equivalent
   * parser) provides at runtime to the compile path. Composed with `body`
   * via `composeLessonSourceForHash` to produce the same sourceHash the
   * runtime cache lookup will compute.
   */
  heading: string;
  /**
   * Parsed lesson body — the content between the heading and the next
   * lesson heading. MUST match what `readAllLessons` provides at runtime.
   */
  body: string;
  /** The compile output to seed into the cache. */
  output: CompileLessonResult;
}

interface MigrationResult {
  seeded: number;
  skipped: number;
}

/**
 * One-shot seed migration: walk an existing compiled-rules.json + lesson
 * sources, materialize the cache entries that would have been produced
 * if the cache had existed from day one. After this step, the first
 * post-migration compile run produces 100% cache hits and `compiled-
 * rules.json` byte-for-byte matches its prior state.
 *
 * Idempotent — running twice with the same inputs writes the same entries
 * a second time (overwrite). Per the impl contract § Migration sequence.
 *
 * Heading + body are taken separately (rather than a single raw-source
 * string) to enforce the canonical `composeLessonSourceForHash` call shape.
 * If migration accepted a free-form `lessonSource` string, the migration
 * and runtime hash paths could diverge (per GCA R2 critical on `#1983`).
 */
export function migrateFromCompiledRules(
  totemDir: string,
  fingerprint: string,
  inputs: MigrationSeedInput[],
  onWarn?: (msg: string) => void,
): MigrationResult {
  if (process.env[DISABLE_ENV_VAR] === '1') {
    return { seeded: 0, skipped: inputs.length };
  }

  let seeded = 0;
  let skipped = 0;
  for (const input of inputs) {
    try {
      const sourceForHash = composeLessonSourceForHash(input.heading, input.body);
      const sourceHash = computeLessonSourceHash(sourceForHash);
      const entry = buildCacheEntry(sourceHash, fingerprint, input.output);
      // writeCacheEntry returns false on I/O failure or when the cache is
      // disabled. Both count as "skipped" — seeded reflects entries actually
      // persisted to disk, matching the operator's mental model of the
      // post-migration cache hit rate.
      if (writeCacheEntry(totemDir, entry, onWarn)) {
        seeded += 1;
      } else {
        skipped += 1;
      }
      // totem-context: intentional cleanup — migration is best-effort per-input; one bad lesson source must not abort seeding the rest. Failed inputs accumulate in `skipped` count and surface via onWarn for operator visibility.
    } catch (err) {
      // totem-context: intentional cleanup — migration is best-effort per-input; one bad lesson source must not abort seeding the rest. Failed inputs accumulate in `skipped` count and surface via onWarn for operator visibility.
      const msg = err instanceof Error ? err.message : String(err);
      onWarn?.(`Compile cache seed skipped for ${input.lessonHash}: ${msg}`);
      skipped += 1;
    }
  }
  return { seeded, skipped };
}

/**
 * List all cache-entry filenames currently on disk. Returns the file basenames
 * (not full paths). Useful for `totem cache --prune-orphans` (out of scope for
 * v1) and for test isolation cleanup.
 */
export function listCacheEntries(totemDir: string): string[] {
  const dir = path.join(totemDir, CACHE_DIR);
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
}
