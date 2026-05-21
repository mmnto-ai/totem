/**
 * Tests for the per-lesson compile cache (Proposal 281).
 *
 * Falsifying-metric test is `partial_mutation_invariant` — exercises the
 * load-bearing claim that a +1-lesson PR produces a 1-row compiled-rules
 * delta, not a 130-row rotation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildCacheEntry,
  type CacheEntry,
  cacheEntryPath,
  computeLessonSourceHash,
  listCacheEntries,
  lookupCacheEntry,
  migrateFromCompiledRules,
  writeCacheEntry,
} from './compile-cache.js';
import type { CompileLessonResult } from './compile-lesson.js';
import { cleanTmpDir } from './test-utils.js';

// ─── Fixtures ───────────────────────────────────────

const FINGERPRINT_A = 'fingerprint-a-1234567890abcdef';
const FINGERPRINT_B = 'fingerprint-b-fedcba0987654321';

/**
 * Workspace-scoped temp root per cohort lesson "os.tmpdir() for agent-readable
 * temp files violates workspace boundary." Tests under this suite create per-it
 * temp dirs under `<package>/.totem/temp/compile-cache-tests/<unique-prefix>`,
 * cleaned in afterEach. `.totem/temp/` is already gitignored.
 *
 * Anchored to the test file's own location (not `process.cwd()`) so the path
 * resolves to the package directory regardless of where vitest is invoked from.
 */
const TEST_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(TEST_FILE_DIR, '..');
const TEST_TEMP_ROOT = path.join(PACKAGE_ROOT, '.totem', 'temp', 'compile-cache-tests');
fs.mkdirSync(TEST_TEMP_ROOT, { recursive: true });

function makeTestTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(TEST_TEMP_ROOT, prefix));
}

function makeCompiledResult(lessonHash: string): CompileLessonResult {
  return {
    status: 'compiled',
    rule: {
      lessonHash,
      lessonHeading: `Lesson ${lessonHash.slice(0, 6)}`,
      pattern: 'foo',
      message: 'avoid foo',
      engine: 'regex',
      fileGlobs: ['**/*.ts'],
      severity: 'warning',
    } as unknown as CompileLessonResult extends { status: 'compiled'; rule: infer R } ? R : never,
  };
}

function makeSkippedResult(hash: string): CompileLessonResult {
  return {
    status: 'skipped',
    hash,
    reasonCode: 'no-pattern-found',
  };
}

// ─── computeLessonSourceHash ────────────────────────

describe('computeLessonSourceHash', () => {
  it('produces the same hash for CRLF and LF content', () => {
    const lf = 'line one\nline two\nline three\n';
    const crlf = 'line one\r\nline two\r\nline three\r\n';
    expect(computeLessonSourceHash(lf)).toBe(computeLessonSourceHash(crlf));
  });

  it('produces different hashes for different content', () => {
    expect(computeLessonSourceHash('content A')).not.toBe(computeLessonSourceHash('content B'));
  });

  it('is stable across calls', () => {
    const input = 'stable content\n';
    expect(computeLessonSourceHash(input)).toBe(computeLessonSourceHash(input));
  });

  it('produces a 64-char hex SHA-256 digest', () => {
    const hash = computeLessonSourceHash('any content');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('distinguishes heading-only edits from body-only edits (CR Major on #1983)', () => {
    // The cache key in compile.ts composes `${lesson.heading}\n${lesson.body}`
    // and hashes that. A heading-only edit must produce a different sourceHash
    // (otherwise the cache hits + preserves stale lessonHash output that would
    // ordinarily rotate to reflect the new heading). This test exercises the
    // composition shape directly.
    const body = 'lesson body content';
    const hashA = computeLessonSourceHash(`Heading A\n${body}`);
    const hashB = computeLessonSourceHash(`Heading B\n${body}`);
    expect(hashA).not.toBe(hashB);

    // And conversely, a body-only edit also invalidates.
    const heading = 'Stable heading';
    const hashBodyA = computeLessonSourceHash(`${heading}\nbody version A`);
    const hashBodyB = computeLessonSourceHash(`${heading}\nbody version B`);
    expect(hashBodyA).not.toBe(hashBodyB);
  });

  it('normalizes trailing whitespace per the impl contract (GCA HIGH on #1983)', () => {
    // The trimEnd() normalization absorbs trailing-newline / trailing-whitespace
    // differences across save behaviors. Inputs that differ ONLY in trailing
    // whitespace must hash identically — otherwise the cache misses on every
    // editor-save-style change.
    const base = 'lesson content';
    expect(computeLessonSourceHash(base)).toBe(computeLessonSourceHash(base + '\n'));
    expect(computeLessonSourceHash(base)).toBe(computeLessonSourceHash(base + '\n\n\n'));
    expect(computeLessonSourceHash(base)).toBe(computeLessonSourceHash(base + '   \t  '));
    expect(computeLessonSourceHash(base)).toBe(computeLessonSourceHash(base + ' \n \n'));
  });
});

// ─── cacheEntryPath ─────────────────────────────────

describe('cacheEntryPath', () => {
  it('uses the first 16 chars of the source hash as the filename', () => {
    const totemDir = '/some/dir/.totem';
    const sourceHash = 'abcdef0123456789' + '0'.repeat(48);
    const expected = path.join(
      totemDir,
      '.totem',
      'cache',
      'compile-lesson',
      'abcdef0123456789.json',
    );
    expect(cacheEntryPath(totemDir, sourceHash)).toBe(expected);
  });
});

// ─── lookupCacheEntry + writeCacheEntry round-trips ─

describe('cache lookup + write round-trip', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTestTmpDir('totem-compile-cache-');
    delete process.env.TOTEM_DISABLE_COMPILE_CACHE;
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
    delete process.env.TOTEM_DISABLE_COMPILE_CACHE;
  });

  it('cache_hit returns the stored entry byte-for-byte', () => {
    const sourceHash = computeLessonSourceHash('lesson source one');
    const output = makeCompiledResult('lesson-1-hash');
    const entry = buildCacheEntry(sourceHash, FINGERPRINT_A, output);
    writeCacheEntry(tmpDir, entry);

    const result = lookupCacheEntry(tmpDir, sourceHash, FINGERPRINT_A);
    expect(result.decision).toBe('cache_hit');
    expect(result.entry).not.toBeNull();
    // Strip the compiledAt timestamp for byte-for-byte comparison of output payload
    expect(result.entry?.output).toEqual(output);
  });

  it('partial_mutation_invariant — modifying one lesson does not rotate siblings', () => {
    // The falsifying-metric test. Build 5 cache entries; modify 1 lesson's
    // source; verify the other 4 entries are still resolvable by their original
    // sourceHash + the modified one is a cache miss.
    const lessons = [
      { source: 'lesson 1 source', hash: 'rule-hash-1' },
      { source: 'lesson 2 source', hash: 'rule-hash-2' },
      { source: 'lesson 3 source', hash: 'rule-hash-3' },
      { source: 'lesson 4 source', hash: 'rule-hash-4' },
      { source: 'lesson 5 source', hash: 'rule-hash-5' },
    ];

    // Initial seed
    for (const lesson of lessons) {
      const sourceHash = computeLessonSourceHash(lesson.source);
      const entry = buildCacheEntry(sourceHash, FINGERPRINT_A, makeCompiledResult(lesson.hash));
      writeCacheEntry(tmpDir, entry);
    }

    // Mutate lesson 3 only
    lessons[2]!.source = 'lesson 3 MUTATED source';

    // Verify the other 4 lessons still cache-hit on their original sourceHash
    const indices = [0, 1, 3, 4];
    for (const i of indices) {
      const sourceHash = computeLessonSourceHash(lessons[i]!.source);
      const result = lookupCacheEntry(tmpDir, sourceHash, FINGERPRINT_A);
      expect(result.decision, `lesson ${i + 1} should hit`).toBe('cache_hit');
    }

    // And the mutated lesson is a no-prior-record miss (new sourceHash)
    const mutatedHash = computeLessonSourceHash(lessons[2]!.source);
    expect(lookupCacheEntry(tmpDir, mutatedHash, FINGERPRINT_A).decision).toBe(
      'cache_miss_no_prior_record',
    );
  });

  it('fingerprint_change_invalidates_all entries', () => {
    const lessons = [
      { source: 'lesson 1 source', hash: 'rule-hash-1' },
      { source: 'lesson 2 source', hash: 'rule-hash-2' },
    ];
    for (const lesson of lessons) {
      const sourceHash = computeLessonSourceHash(lesson.source);
      const entry = buildCacheEntry(sourceHash, FINGERPRINT_A, makeCompiledResult(lesson.hash));
      writeCacheEntry(tmpDir, entry);
    }

    for (const lesson of lessons) {
      const sourceHash = computeLessonSourceHash(lesson.source);
      const result = lookupCacheEntry(tmpDir, sourceHash, FINGERPRINT_B);
      expect(result.decision).toBe('cache_miss_fingerprint_changed');
      expect(result.entry).toBeNull();
    }
  });

  it('source_change_invalidates_one — only the changed lesson misses', () => {
    const original = 'original source';
    const modified = 'modified source';
    const originalHash = computeLessonSourceHash(original);
    writeCacheEntry(
      tmpDir,
      buildCacheEntry(originalHash, FINGERPRINT_A, makeCompiledResult('original-rule')),
    );

    // Lookup of the original still hits
    expect(lookupCacheEntry(tmpDir, originalHash, FINGERPRINT_A).decision).toBe('cache_hit');

    // Lookup of the modified misses (different sourceHash)
    const modifiedHash = computeLessonSourceHash(modified);
    expect(lookupCacheEntry(tmpDir, modifiedHash, FINGERPRINT_A).decision).toBe(
      'cache_miss_no_prior_record',
    );
  });

  it('force option bypasses the cache without reading disk', () => {
    const sourceHash = computeLessonSourceHash('any source');
    writeCacheEntry(
      tmpDir,
      buildCacheEntry(sourceHash, FINGERPRINT_A, makeCompiledResult('rule-x')),
    );

    const result = lookupCacheEntry(tmpDir, sourceHash, FINGERPRINT_A, { force: true });
    expect(result.decision).toBe('cache_miss_force');
    expect(result.entry).toBeNull();
  });

  it('reserves the stableId slot — schema accepts and round-trips it', () => {
    // P281 never writes stableId. This test asserts that an entry WRITTEN with
    // a stableId (e.g., by future P280 wiring) parses correctly and the slot
    // round-trips. Per #387 § Dependencies — load-bearing reservation.
    const sourceHash = computeLessonSourceHash('lesson with future id');
    const entry: CacheEntry = {
      sourceHash,
      stableId: 'future-p280-stable-id',
      fingerprint: FINGERPRINT_A,
      output: makeCompiledResult('rule-with-stable-id'),
      compiledAt: new Date().toISOString(),
    };
    writeCacheEntry(tmpDir, entry);

    const result = lookupCacheEntry(tmpDir, sourceHash, FINGERPRINT_A);
    expect(result.decision).toBe('cache_hit');
    expect(result.entry?.stableId).toBe('future-p280-stable-id');
  });

  it('a malformed cache file produces a graceful cache miss (no throw)', () => {
    const sourceHash = computeLessonSourceHash('lesson with bad cache file');
    const filePath = cacheEntryPath(tmpDir, sourceHash);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{ this is not valid JSON', 'utf-8');

    const result = lookupCacheEntry(tmpDir, sourceHash, FINGERPRINT_A);
    expect(result.decision).toBe('cache_miss_no_prior_record');
    expect(result.entry).toBeNull();
  });

  it('a schema-invalid cache entry produces a graceful cache miss', () => {
    const sourceHash = computeLessonSourceHash('lesson with bad schema');
    const filePath = cacheEntryPath(tmpDir, sourceHash);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // Output.status is required to be one of the known enum values
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        sourceHash,
        fingerprint: FINGERPRINT_A,
        output: { status: 'gibberish' },
        compiledAt: '2026-05-21T00:00:00.000Z',
      }),
      'utf-8',
    );

    const result = lookupCacheEntry(tmpDir, sourceHash, FINGERPRINT_A);
    expect(result.decision).toBe('cache_miss_no_prior_record');
  });

  it('hash-disagreeing cache file is treated as cache miss', () => {
    // Defensive against manual cache edits — if the file at path-for-hash-X
    // contains an entry claiming sourceHash-Y, treat as miss.
    const realHash = computeLessonSourceHash('real content');
    const filePath = cacheEntryPath(tmpDir, realHash);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        sourceHash: 'some-other-hash',
        fingerprint: FINGERPRINT_A,
        output: { status: 'compiled' },
        compiledAt: '2026-05-21T00:00:00.000Z',
      }),
      'utf-8',
    );

    const result = lookupCacheEntry(tmpDir, realHash, FINGERPRINT_A);
    expect(result.decision).toBe('cache_miss_source_changed');
  });

  it('writes the entry as pretty-printed JSON with a trailing newline', () => {
    const sourceHash = computeLessonSourceHash('formatting check');
    const entry = buildCacheEntry(sourceHash, FINGERPRINT_A, makeCompiledResult('rule-format'));
    writeCacheEntry(tmpDir, entry);

    const filePath = cacheEntryPath(tmpDir, sourceHash);
    const raw = fs.readFileSync(filePath, 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
    // Pretty-printed: multiple lines
    expect(raw.split('\n').length).toBeGreaterThan(3);
  });

  it('round-trips a skipped CompileLessonResult', () => {
    const sourceHash = computeLessonSourceHash('lesson that gets skipped');
    const entry = buildCacheEntry(
      sourceHash,
      FINGERPRINT_A,
      makeSkippedResult('skipped-lesson-hash'),
    );
    writeCacheEntry(tmpDir, entry);

    const result = lookupCacheEntry(tmpDir, sourceHash, FINGERPRINT_A);
    expect(result.decision).toBe('cache_hit');
    expect(result.entry?.output.status).toBe('skipped');
  });
});

// ─── TOTEM_DISABLE_COMPILE_CACHE escape hatch ──────

describe('TOTEM_DISABLE_COMPILE_CACHE env var', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTestTmpDir('totem-compile-cache-env-');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
    delete process.env.TOTEM_DISABLE_COMPILE_CACHE;
  });

  it('lookup returns no-prior-record when disabled, even if a valid entry exists on disk', () => {
    const sourceHash = computeLessonSourceHash('disable env test');
    // Seed first without the env var so the file lands on disk
    writeCacheEntry(
      tmpDir,
      buildCacheEntry(sourceHash, FINGERPRINT_A, makeCompiledResult('rule-disable')),
    );

    process.env.TOTEM_DISABLE_COMPILE_CACHE = '1';
    const result = lookupCacheEntry(tmpDir, sourceHash, FINGERPRINT_A);
    expect(result.decision).toBe('cache_miss_no_prior_record');
    expect(result.entry).toBeNull();
  });

  it('write is a no-op when the env var is set', () => {
    process.env.TOTEM_DISABLE_COMPILE_CACHE = '1';
    const sourceHash = computeLessonSourceHash('disable env write');
    writeCacheEntry(
      tmpDir,
      buildCacheEntry(sourceHash, FINGERPRINT_A, makeCompiledResult('rule-disable-write')),
    );

    const filePath = cacheEntryPath(tmpDir, sourceHash);
    expect(fs.existsSync(filePath)).toBe(false);
  });
});

// ─── Migration seed ─────────────────────────────────

describe('migrateFromCompiledRules', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTestTmpDir('totem-compile-cache-migrate-');
    delete process.env.TOTEM_DISABLE_COMPILE_CACHE;
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
    delete process.env.TOTEM_DISABLE_COMPILE_CACHE;
  });

  it('seeds 100% cache hit for subsequent lookups', () => {
    const inputs = [
      {
        lessonHash: 'seed-1',
        lessonSource: 'seed lesson 1 source',
        output: makeCompiledResult('seed-1'),
      },
      {
        lessonHash: 'seed-2',
        lessonSource: 'seed lesson 2 source',
        output: makeCompiledResult('seed-2'),
      },
      {
        lessonHash: 'seed-3',
        lessonSource: 'seed lesson 3 source',
        output: makeCompiledResult('seed-3'),
      },
    ];

    const result = migrateFromCompiledRules(tmpDir, FINGERPRINT_A, inputs);
    expect(result.seeded).toBe(3);
    expect(result.skipped).toBe(0);

    for (const input of inputs) {
      const sourceHash = computeLessonSourceHash(input.lessonSource);
      const lookup = lookupCacheEntry(tmpDir, sourceHash, FINGERPRINT_A);
      expect(lookup.decision).toBe('cache_hit');
    }
  });

  it('is idempotent — running twice produces the same on-disk state', () => {
    const inputs = [
      {
        lessonHash: 'idempotent-1',
        lessonSource: 'idempotent source one',
        output: makeCompiledResult('idempotent-1'),
      },
    ];

    migrateFromCompiledRules(tmpDir, FINGERPRINT_A, inputs);
    const sourceHash = computeLessonSourceHash(inputs[0]!.lessonSource);
    const after1 = fs.readFileSync(cacheEntryPath(tmpDir, sourceHash), 'utf-8');

    migrateFromCompiledRules(tmpDir, FINGERPRINT_A, inputs);
    const after2 = fs.readFileSync(cacheEntryPath(tmpDir, sourceHash), 'utf-8');

    // Bodies match except possibly compiledAt; structural equivalence post-parse
    const parsed1 = JSON.parse(after1);
    const parsed2 = JSON.parse(after2);
    parsed1.compiledAt = parsed2.compiledAt = 'normalized';
    expect(parsed1).toEqual(parsed2);
  });

  it('skips when env var disables cache, reporting all inputs as skipped', () => {
    process.env.TOTEM_DISABLE_COMPILE_CACHE = '1';
    const inputs = [
      {
        lessonHash: 'disabled-1',
        lessonSource: 'disabled source',
        output: makeCompiledResult('disabled-1'),
      },
    ];
    const result = migrateFromCompiledRules(tmpDir, FINGERPRINT_A, inputs);
    expect(result.seeded).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('seeded count reflects entries actually persisted (write failures land in skipped)', () => {
    // Defensive guarantee: even if `writeCacheEntry` returns false (write
    // failure or env-disable), the seeded counter must not increment. This
    // tests the writeCacheEntry boolean-return contract from the migration
    // bookkeeping path.
    process.env.TOTEM_DISABLE_COMPILE_CACHE = '1';
    const inputs = [
      { lessonHash: 'a', lessonSource: 'a source', output: makeCompiledResult('a') },
      { lessonHash: 'b', lessonSource: 'b source', output: makeCompiledResult('b') },
      { lessonHash: 'c', lessonSource: 'c source', output: makeCompiledResult('c') },
    ];
    const result = migrateFromCompiledRules(tmpDir, FINGERPRINT_A, inputs);
    expect(result.seeded).toBe(0);
    expect(result.skipped).toBe(3);
  });
});

// ─── listCacheEntries ───────────────────────────────

describe('listCacheEntries', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTestTmpDir('totem-compile-cache-list-');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns empty array when the cache directory does not exist', () => {
    expect(listCacheEntries(tmpDir)).toEqual([]);
  });

  it('lists all written cache entry filenames', () => {
    const sources = ['lesson alpha', 'lesson beta', 'lesson gamma'];
    for (const src of sources) {
      const sourceHash = computeLessonSourceHash(src);
      writeCacheEntry(tmpDir, buildCacheEntry(sourceHash, FINGERPRINT_A, makeCompiledResult(src)));
    }

    const entries = listCacheEntries(tmpDir);
    expect(entries.length).toBe(3);
    for (const entry of entries) {
      expect(entry).toMatch(/^[a-f0-9]{16}\.json$/);
    }
  });

  it('ignores non-json files in the cache directory', () => {
    const sourceHash = computeLessonSourceHash('only json counts');
    writeCacheEntry(tmpDir, buildCacheEntry(sourceHash, FINGERPRINT_A, makeCompiledResult('only')));

    // Drop a stray file beside the cache entries
    const cacheDir = path.dirname(cacheEntryPath(tmpDir, sourceHash));
    fs.writeFileSync(path.join(cacheDir, 'README.txt'), 'stray');

    const entries = listCacheEntries(tmpDir);
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatch(/\.json$/);
  });
});

// ─── writeCacheEntry return value ───────────────────

describe('writeCacheEntry return value', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTestTmpDir('totem-compile-cache-write-');
    delete process.env.TOTEM_DISABLE_COMPILE_CACHE;
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
    delete process.env.TOTEM_DISABLE_COMPILE_CACHE;
  });

  it('returns true on successful write', () => {
    const sourceHash = computeLessonSourceHash('write-ok source');
    const result = writeCacheEntry(
      tmpDir,
      buildCacheEntry(sourceHash, FINGERPRINT_A, makeCompiledResult('write-ok')),
    );
    expect(result).toBe(true);
  });

  it('returns false when the env-var disables the cache', () => {
    process.env.TOTEM_DISABLE_COMPILE_CACHE = '1';
    const sourceHash = computeLessonSourceHash('write-disabled source');
    const result = writeCacheEntry(
      tmpDir,
      buildCacheEntry(sourceHash, FINGERPRINT_A, makeCompiledResult('write-disabled')),
    );
    expect(result).toBe(false);
  });
});
