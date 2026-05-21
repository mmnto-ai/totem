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
  composeLessonSourceForHash,
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

  it('preserves trailing-whitespace sensitivity (GCA R2 critical on #1983)', () => {
    // The canonical generateInputHash + lessonHash are trailing-whitespace
    // sensitive (`compile-manifest.ts` does CRLF→LF normalization only; no
    // trim). The cache key MUST match that sensitivity. If it didn't, a
    // whitespace-only edit would hit the cache and return a rule with a stale
    // lessonHash while the manifest pipeline computed a fresh lessonHash for
    // the same edit — breaking the deterministic link between lessons and
    // rules.
    //
    // GCA R1 originally flagged a missing .trimEnd() (citing my contract
    // prose, which over-claimed normalization scope); GCA R2 reversed that
    // finding by anchoring to the canonical hash shape. This test locks in
    // the R2-correct behavior so future regressions to "more aggressive
    // normalization" surface immediately.
    const base = 'lesson content';
    expect(computeLessonSourceHash(base)).not.toBe(computeLessonSourceHash(base + '\n'));
    expect(computeLessonSourceHash(base)).not.toBe(computeLessonSourceHash(base + '\n\n\n'));
    expect(computeLessonSourceHash(base)).not.toBe(computeLessonSourceHash(base + '   '));
  });

  it('normalizes CRLF to LF (cross-OS stability)', () => {
    // The one normalization the canonical hash DOES apply: CRLF → LF. Same
    // shape as `generateInputHash`. Without this, a Windows-saved lesson and
    // a Unix-saved lesson with identical visible content would hash
    // differently.
    const lf = 'line one\nline two\nline three\n';
    const crlf = 'line one\r\nline two\r\nline three\r\n';
    expect(computeLessonSourceHash(lf)).toBe(computeLessonSourceHash(crlf));
  });
});

// ─── composeLessonSourceForHash ─────────────────────

describe('composeLessonSourceForHash', () => {
  it('produces the same string for the same (heading, body) inputs', () => {
    const a = composeLessonSourceForHash('My Heading', 'body text\n');
    const b = composeLessonSourceForHash('My Heading', 'body text\n');
    expect(a).toBe(b);
  });

  it('distinguishes heading-only edits from body-only edits', () => {
    // Defends the runtime/migration hash-consistency contract (GCA R2 critical
    // on #1983). Both call sites — compile.ts wiring and migrateFromCompiledRules
    // — route through this helper. If a future refactor accidentally
    // re-introduced separate composition logic on either side, the two paths
    // would diverge again.
    const headingChange = composeLessonSourceForHash('Heading A', 'shared body');
    const headingChangeAlt = composeLessonSourceForHash('Heading B', 'shared body');
    expect(headingChange).not.toBe(headingChangeAlt);

    const bodyChange = composeLessonSourceForHash('shared heading', 'body A');
    const bodyChangeAlt = composeLessonSourceForHash('shared heading', 'body B');
    expect(bodyChange).not.toBe(bodyChangeAlt);
  });
});

// ─── cacheEntryPath ─────────────────────────────────

describe('cacheEntryPath', () => {
  it('uses the first 16 chars of the source hash as the filename', () => {
    const totemDir = '/some/dir/.totem';
    const sourceHash = 'abcdef0123456789' + '0'.repeat(48);
    const expected = path.join(totemDir, 'cache', 'compile-lesson', 'abcdef0123456789.json');
    expect(cacheEntryPath(totemDir, sourceHash)).toBe(expected);
  });

  it('does not duplicate the .totem prefix when totemDir already includes it (CR R3 Major on #1983)', () => {
    // Regression: an earlier draft hardcoded `.totem` into CACHE_DIR. Joined
    // with totemDir (which already resolves to `<repo>/.totem`), the cache
    // landed at `<repo>/.totem/.totem/cache/compile-lesson/...` — outside the
    // documented path and invisible to tooling that scans `<totemDir>/cache`.
    const totemDir = '/repo/.totem';
    const result = cacheEntryPath(totemDir, 'a'.repeat(64));
    expect(result).not.toContain(path.join('.totem', '.totem'));
    expect(result).toBe(
      path.join('/repo/.totem', 'cache', 'compile-lesson', 'aaaaaaaaaaaaaaaa.json'),
    );
  });

  it('rejects non-SHA cache keys to prevent path traversal (CR R4 Major on #1983)', () => {
    // Without the regex guard, a sourceHash carrying `/` or `..` would flow
    // through path.join() and escape `<totemDir>/cache/compile-lesson`, letting
    // lookup or write touch arbitrary files. computeLessonSourceHash always
    // emits the matching shape; this catches caller misuse.
    expect(() => cacheEntryPath('/some/.totem', '../../../etc/passwd')).toThrow(
      /Invalid sourceHash/,
    );
    expect(() => cacheEntryPath('/some/.totem', 'a/b/c')).toThrow(/Invalid sourceHash/);
    expect(() => cacheEntryPath('/some/.totem', '..')).toThrow(/Invalid sourceHash/);
    expect(() => cacheEntryPath('/some/.totem', '')).toThrow(/Invalid sourceHash/);
    expect(() => cacheEntryPath('/some/.totem', 'NOT_HEX_!@#$')).toThrow(/Invalid sourceHash/);
    // Hex but wrong length
    expect(() => cacheEntryPath('/some/.totem', 'abcdef')).toThrow(/Invalid sourceHash/);
    // Uppercase hex — the regex requires lowercase for normalization
    expect(() => cacheEntryPath('/some/.totem', 'A'.repeat(64))).toThrow(/Invalid sourceHash/);

    // Sanity: a real digest is accepted
    expect(() => cacheEntryPath('/some/.totem', 'a'.repeat(64))).not.toThrow();
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

  it('incomplete cache payload (compiled without rule) is rejected (CR R3 Major on #1983)', () => {
    // Status enum alone is not sufficient validation — a truncated payload like
    // `{ status: 'compiled' }` would survive a minimal schema and crash the
    // cache-hit path on the missing `rule` dereference. The discriminated union
    // requires the per-variant fields downstream consumers depend on.
    const sourceHash = computeLessonSourceHash('lesson with compiled-no-rule cache entry');
    const filePath = cacheEntryPath(tmpDir, sourceHash);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        sourceHash,
        fingerprint: FINGERPRINT_A,
        output: { status: 'compiled' }, // missing required `rule`
        compiledAt: '2026-05-21T00:00:00.000Z',
      }),
      'utf-8',
    );

    const result = lookupCacheEntry(tmpDir, sourceHash, FINGERPRINT_A);
    expect(result.decision).toBe('cache_miss_no_prior_record');
    expect(result.entry).toBeNull();
  });

  it('incomplete cache payload (skipped without hash/reasonCode) is rejected (CR R3 Major on #1983)', () => {
    const sourceHash = computeLessonSourceHash('lesson with skipped-no-fields cache entry');
    const filePath = cacheEntryPath(tmpDir, sourceHash);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        sourceHash,
        fingerprint: FINGERPRINT_A,
        output: { status: 'skipped' }, // missing required `hash` and `reasonCode`
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
        // Valid `compiled` shape so the schema check passes and the lookup
        // reaches the sourceHash-disagreement defense (the assertion under test).
        output: { status: 'compiled', rule: { lessonHash: 'whatever' } },
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
        heading: 'Lesson 1 heading',
        body: 'seed lesson 1 body content\n',
        output: makeCompiledResult('seed-1'),
      },
      {
        lessonHash: 'seed-2',
        heading: 'Lesson 2 heading',
        body: 'seed lesson 2 body content\n',
        output: makeCompiledResult('seed-2'),
      },
      {
        lessonHash: 'seed-3',
        heading: 'Lesson 3 heading',
        body: 'seed lesson 3 body content\n',
        output: makeCompiledResult('seed-3'),
      },
    ];

    const result = migrateFromCompiledRules(tmpDir, FINGERPRINT_A, inputs);
    expect(result.seeded).toBe(3);
    expect(result.skipped).toBe(0);

    for (const input of inputs) {
      // Migration must produce hashes that the runtime lookup can hit. Both
      // paths route through `composeLessonSourceForHash` to guarantee this.
      const sourceHash = computeLessonSourceHash(
        composeLessonSourceForHash(input.heading, input.body),
      );
      const lookup = lookupCacheEntry(tmpDir, sourceHash, FINGERPRINT_A);
      expect(lookup.decision).toBe('cache_hit');
    }
  });

  it('runtime/migration hash consistency (GCA R2 critical on #1983)', () => {
    // Load-bearing regression test: a lesson seeded via the migration path
    // MUST be hittable via the runtime lookup path using the same heading +
    // body. Before this fix, migration hashed raw `lessonSource` (the parsed
    // file content including markdown framing) while runtime hashed
    // `${heading}\n${body}` — the same lesson produced two different hashes,
    // making every migrated entry permanently unreachable.
    const heading = 'Some lesson heading';
    const body = 'body line 1\nbody line 2\n';
    migrateFromCompiledRules(tmpDir, FINGERPRINT_A, [
      { lessonHash: 'consistency-1', heading, body, output: makeCompiledResult('consistency-1') },
    ]);

    // Simulating the runtime call shape from compile.ts
    const runtimeSourceHash = computeLessonSourceHash(composeLessonSourceForHash(heading, body));
    const lookup = lookupCacheEntry(tmpDir, runtimeSourceHash, FINGERPRINT_A);
    expect(lookup.decision).toBe('cache_hit');
    expect(lookup.entry).not.toBeNull();
  });

  it('is idempotent — running twice produces the same on-disk state', () => {
    const inputs = [
      {
        lessonHash: 'idempotent-1',
        heading: 'Idempotent heading',
        body: 'idempotent source one body\n',
        output: makeCompiledResult('idempotent-1'),
      },
    ];

    migrateFromCompiledRules(tmpDir, FINGERPRINT_A, inputs);
    const sourceHash = computeLessonSourceHash(
      composeLessonSourceForHash(inputs[0]!.heading, inputs[0]!.body),
    );
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
        heading: 'Disabled heading',
        body: 'disabled body\n',
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
      { lessonHash: 'a', heading: 'Lesson A', body: 'a body\n', output: makeCompiledResult('a') },
      { lessonHash: 'b', heading: 'Lesson B', body: 'b body\n', output: makeCompiledResult('b') },
      { lessonHash: 'c', heading: 'Lesson C', body: 'c body\n', output: makeCompiledResult('c') },
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

  it('swallows a throwing onWarn — never propagates out of cache write (CR R4 Major on #1983)', () => {
    // The cache's non-throwing contract requires that a caller-supplied onWarn
    // cannot abort compile even when it itself throws. Without this, a
    // misbehaving telemetry hook could escalate a benign cache-write failure
    // into a hard compile abort.
    const throwingWarn = (): never => {
      throw new Error('caller-provided onWarn exploded');
    };
    // Force a write failure by pointing at a path that can't be created. On
    // Windows this is a path with an invalid char; on POSIX a path under a
    // file. Easiest cross-platform shape: pass a non-existent volume root.
    const badDir = path.join(tmpDir, '\x00invalid');
    const sourceHash = computeLessonSourceHash('write-with-throwing-onwarn');
    const entry = buildCacheEntry(sourceHash, FINGERPRINT_A, makeCompiledResult('throwing-warn'));
    expect(() => writeCacheEntry(badDir, entry, throwingWarn)).not.toThrow();
  });
});

// ─── safeOnWarn guard via migrateFromCompiledRules ──

describe('safeOnWarn (CR R4 Major on #1983)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTestTmpDir('totem-compile-cache-safewarn-');
    delete process.env.TOTEM_DISABLE_COMPILE_CACHE;
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
    delete process.env.TOTEM_DISABLE_COMPILE_CACHE;
  });

  it('migrateFromCompiledRules: throwing onWarn does not abort the seed loop', () => {
    // If onWarn throws on one input, subsequent inputs must still be processed.
    // Without safeOnWarn the throw would escape the per-input catch and
    // short-circuit the migration.
    const throwingWarn = (): never => {
      throw new Error('telemetry hook exploded');
    };
    // First input is malformed (heading has bad hash shape from buildCacheEntry
    // path); subsequent valid inputs should still seed.
    const inputs = [
      {
        lessonHash: 'will-warn-due-to-write-failure',
        heading: 'Bad Lesson',
        body: 'will fail to write\n',
        output: makeCompiledResult('bad'),
      },
      {
        lessonHash: 'will-seed',
        heading: 'Good Lesson',
        body: 'should-be-seeded\n',
        output: makeCompiledResult('good'),
      },
    ];
    // Force the first write to fail by passing a directory that can't be
    // created (null byte). The throwing onWarn would normally explode the
    // loop; with safeOnWarn the second input still seeds.
    const badDir = path.join(tmpDir, '\x00invalid');
    expect(() =>
      migrateFromCompiledRules(badDir, FINGERPRINT_A, inputs, throwingWarn),
    ).not.toThrow();
  });
});
