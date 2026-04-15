import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Embedder } from '../embedders/embedder.js';
import { cleanTmpDir } from '../test-utils.js';
import type { Chunk } from '../types.js';
import { escapeSqlString, LanceStore } from './lance-store.js';

/** Deterministic fake embedder — hashes text into a fixed-dimension vector. */
class FakeEmbedder implements Embedder {
  readonly dimensions = 8;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const vec = new Array(this.dimensions).fill(0) as number[];
      for (let i = 0; i < t.length; i++) {
        vec[i % this.dimensions] += t.charCodeAt(i) / 1000;
      }
      return vec;
    });
  }
}

function makeChunk(overrides: Partial<Chunk> = {}): Chunk {
  return {
    content: 'test content',
    contextPrefix: 'File: test.ts',
    filePath: 'src/test.ts',
    type: 'code',
    strategy: 'typescript-ast',
    label: 'function: test',
    startLine: 1,
    endLine: 10,
    metadata: {},
    ...overrides,
  };
}

describe('escapeSqlString', () => {
  it('doubles single quotes', () => {
    expect(escapeSqlString("it's")).toBe("it''s");
  });

  it('handles strings with no special characters', () => {
    expect(escapeSqlString('src/index.ts')).toBe('src/index.ts');
  });

  it('preserves backslashes (DataFusion treats them as literals)', () => {
    expect(escapeSqlString('foo\\bar\\baz')).toBe('foo\\bar\\baz');
  });

  it('escapes quotes adjacent to backslashes', () => {
    // Input: foo\'bar (actual chars: f,o,o,\,',b,a,r)
    // Only the quote is doubled; backslash is literal in DataFusion SQL.
    expect(escapeSqlString("foo\\'bar")).toBe("foo\\''bar");
  });

  it('escapes trailing backslash-quote sequences', () => {
    // Input: foo\' (actual chars: f,o,o,\,')
    expect(escapeSqlString("foo\\'")).toBe("foo\\''");
  });
});

describe('LanceStore', () => {
  let tmpDir: string;
  let store: LanceStore;
  let embedder: FakeEmbedder;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lance-test-'));
    embedder = new FakeEmbedder();
    store = new LanceStore(tmpDir, embedder, { absolutePathRoot: tmpDir });
    await store.connect();
  });

  afterEach(async () => {
    cleanTmpDir(tmpDir);
  });

  describe('insert + isEmpty', () => {
    it('starts empty', async () => {
      expect(await store.isEmpty()).toBe(true);
    });

    it('is not empty after insert', async () => {
      await store.insert([makeChunk()]);
      expect(await store.isEmpty()).toBe(false);
    });
  });

  describe('stats', () => {
    it('returns zero stats when empty', async () => {
      const stats = await store.stats();
      expect(stats.totalChunks).toBe(0);
      expect(stats.byType).toEqual({});
    });

    it('counts chunks by type', async () => {
      await store.insert([
        makeChunk({ type: 'code', content: 'a' }),
        makeChunk({ type: 'code', content: 'b' }),
        makeChunk({ type: 'spec', content: 'c' }),
      ]);

      const stats = await store.stats();
      expect(stats.totalChunks).toBe(3);
      expect(stats.byType).toEqual({ code: 2, spec: 1 });
    });
  });

  describe('count', () => {
    it('returns 0 when empty', async () => {
      expect(await store.count()).toBe(0);
    });

    it('returns total row count after inserts', async () => {
      await store.insert([
        makeChunk({ type: 'code', content: 'a' }),
        makeChunk({ type: 'spec', content: 'b' }),
      ]);
      expect(await store.count()).toBe(2);
    });
  });

  describe('deleteByFile', () => {
    it('deletes chunks for a specific file', async () => {
      await store.insert([
        makeChunk({ filePath: 'src/a.ts', content: 'file a' }),
        makeChunk({ filePath: 'src/b.ts', content: 'file b' }),
      ]);

      expect((await store.stats()).totalChunks).toBe(2);

      await store.deleteByFile('src/a.ts');

      const stats = await store.stats();
      expect(stats.totalChunks).toBe(1);
    });

    it('does not delete chunks from other files', async () => {
      await store.insert([
        makeChunk({ filePath: 'src/a.ts', content: 'file a chunk 1' }),
        makeChunk({ filePath: 'src/a.ts', content: 'file a chunk 2' }),
        makeChunk({ filePath: 'src/b.ts', content: 'file b' }),
      ]);

      await store.deleteByFile('src/a.ts');

      const stats = await store.stats();
      expect(stats.totalChunks).toBe(1);
    });

    it('handles paths with spaces', async () => {
      await store.insert([
        makeChunk({ filePath: 'src/My Folder/file.ts', content: 'spaced path' }),
        makeChunk({ filePath: 'src/other.ts', content: 'other' }),
      ]);

      await store.deleteByFile('src/My Folder/file.ts');

      const stats = await store.stats();
      expect(stats.totalChunks).toBe(1);
    });

    it('handles paths with single quotes', async () => {
      await store.insert([
        makeChunk({ filePath: "src/user's-config.ts", content: 'quoted path' }),
        makeChunk({ filePath: 'src/other.ts', content: 'other' }),
      ]);

      await store.deleteByFile("src/user's-config.ts");

      const stats = await store.stats();
      expect(stats.totalChunks).toBe(1);
    });

    it('handles paths with backslash-quote (adversarial)', async () => {
      await store.insert([
        makeChunk({ filePath: "foo\\'bar", content: 'adversarial bq' }),
        makeChunk({ filePath: 'src/safe.ts', content: 'safe file' }),
      ]);

      await store.deleteByFile("foo\\'bar");

      const stats = await store.stats();
      expect(stats.totalChunks).toBe(1);
    });

    it('handles paths with only backslashes (adversarial)', async () => {
      await store.insert([
        makeChunk({ filePath: 'foo\\bar\\baz', content: 'backslash path' }),
        makeChunk({ filePath: 'src/safe.ts', content: 'safe file' }),
      ]);

      await store.deleteByFile('foo\\bar\\baz');

      const stats = await store.stats();
      expect(stats.totalChunks).toBe(1);
    });

    it('handles camelCase paths', async () => {
      await store.insert([
        makeChunk({ filePath: 'src/myComponent/CamelCase.tsx', content: 'camel' }),
        makeChunk({ filePath: 'src/other.ts', content: 'other' }),
      ]);

      await store.deleteByFile('src/myComponent/CamelCase.tsx');

      const stats = await store.stats();
      expect(stats.totalChunks).toBe(1);
    });

    it('is a no-op when table is empty', async () => {
      // Should not throw
      await store.deleteByFile('nonexistent.ts');
    });
  });

  describe('search', () => {
    it('returns empty when table is empty', async () => {
      const results = await store.search({ query: 'test' });
      expect(results).toEqual([]);
    });

    it('returns results matching query', async () => {
      await store.insert([
        makeChunk({ content: 'handles user authentication', label: 'auth' }),
        makeChunk({ content: 'renders the dashboard component', label: 'dashboard' }),
      ]);

      const results = await store.search({ query: 'authentication login', maxResults: 2 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.score).toBeGreaterThan(0);
    });

    it('filters by type', async () => {
      await store.insert([
        makeChunk({ type: 'code', content: 'code content alpha' }),
        makeChunk({ type: 'spec', content: 'spec content beta' }),
      ]);

      const results = await store.search({ query: 'content', typeFilter: 'spec', maxResults: 10 });
      expect(results.every((r) => r.type === 'spec')).toBe(true);
    });

    it('filters by boundary (file path prefix)', async () => {
      await store.insert([
        makeChunk({ filePath: 'packages/core/src/compiler.ts', content: 'core compiler logic' }),
        makeChunk({ filePath: 'packages/mcp/src/tools.ts', content: 'mcp tool handler' }),
        makeChunk({ filePath: 'packages/cli/src/index.ts', content: 'cli entry point' }),
      ]);

      const results = await store.search({
        query: 'logic handler entry',
        boundary: 'packages/mcp/',
        maxResults: 10,
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.filePath.startsWith('packages/mcp'))).toBe(true);
    });

    it('returns all results when boundary is omitted', async () => {
      await store.insert([
        makeChunk({ filePath: 'packages/core/src/a.ts', content: 'alpha content' }),
        makeChunk({ filePath: 'packages/mcp/src/b.ts', content: 'beta content' }),
      ]);

      const results = await store.search({ query: 'content', maxResults: 10 });
      expect(results.length).toBe(2);
    });

    it('filters by array boundary (OR across prefixes)', async () => {
      await store.insert([
        makeChunk({ filePath: 'packages/core/src/a.ts', content: 'core logic delta' }),
        makeChunk({ filePath: 'packages/mcp/src/b.ts', content: 'mcp handler delta' }),
        makeChunk({ filePath: 'packages/cli/src/c.ts', content: 'cli command delta' }),
      ]);

      const results = await store.search({
        query: 'delta',
        boundary: ['packages/core/', 'packages/mcp/'],
        maxResults: 10,
      });
      expect(results.length).toBe(2);
      expect(
        results.every(
          (r) => r.filePath.startsWith('packages/core/') || r.filePath.startsWith('packages/mcp/'),
        ),
      ).toBe(true);
    });

    it('ignores empty string boundary', async () => {
      await store.insert([
        makeChunk({ filePath: 'packages/core/src/a.ts', content: 'gamma content' }),
      ]);

      const results = await store.search({ query: 'gamma', boundary: '', maxResults: 10 });
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('reset', () => {
    it('drops all data', async () => {
      await store.insert([makeChunk()]);
      expect(await store.isEmpty()).toBe(false);

      await store.reset();
      expect(await store.isEmpty()).toBe(true);
    });
  });

  describe('reconnect', () => {
    it('re-opens the connection', async () => {
      await store.insert([makeChunk()]);
      await store.reconnect();
      expect(await store.isEmpty()).toBe(false);
    });
  });

  describe('stale-handle resilience (mmnto/totem#1418)', () => {
    it('surfaces rows written by a separate instance without explicit reconnect', async () => {
      // Reader connects to an empty directory first.
      const readerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lance-stale-'));
      const readerEmbedder = new FakeEmbedder();
      const reader = new LanceStore(readerDir, readerEmbedder, { absolutePathRoot: readerDir });
      await reader.connect();

      try {
        // First query on an empty store: zero results, refresh counter ticks.
        const initial = await reader.search({ query: 'alpha' });
        expect(initial).toEqual([]);
        const refreshAfterFirst = reader.readRefreshCount;
        expect(refreshAfterFirst).toBeGreaterThan(0);

        // A separate LanceStore (standing in for `totem sync` as an external
        // process) writes rows into the SAME directory. The reader holds a
        // stale view at this point in the timeline.
        const writerEmbedder = new FakeEmbedder();
        const writer = new LanceStore(readerDir, writerEmbedder, {
          absolutePathRoot: readerDir,
        });
        await writer.connect();
        await writer.insert([
          makeChunk({ content: 'alpha fresh content from external writer', label: 'alpha-row' }),
          makeChunk({ content: 'beta fresh content from external writer', label: 'beta-row' }),
        ]);

        // Reader queries again WITHOUT calling reconnect(). The fix reopens
        // the LanceDB handle inside search(), so the externally-written rows
        // become visible on this next call.
        const refreshed = await reader.search({ query: 'alpha content' });
        expect(refreshed.length).toBeGreaterThan(0);
        expect(refreshed.some((r) => r.label === 'alpha-row')).toBe(true);

        // Every search() call reopens. Confirms the reopen-per-query contract
        // the fix relies on.
        expect(reader.readRefreshCount).toBe(refreshAfterFirst + 1);
      } finally {
        cleanTmpDir(readerDir);
      }
    });

    it('increments readRefreshCount on every search call', async () => {
      await store.insert([makeChunk({ content: 'counter test content' })]);
      const before = store.readRefreshCount;
      await store.search({ query: 'counter' });
      await store.search({ query: 'counter' });
      await store.search({ query: 'counter' });
      expect(store.readRefreshCount).toBe(before + 3);
    });

    it('increments readRefreshCount on searchFts call', async () => {
      await store.insert([makeChunk({ content: 'fts counter content' })]);
      await store.createFtsIndex();
      const before = store.readRefreshCount;
      await store.searchFts({ query: 'fts' });
      expect(store.readRefreshCount).toBe(before + 1);
    });

    it('handles concurrent searches without one closing the other handle', async () => {
      // Shield CRITICAL guard: the reopen-per-query strategy used to close
      // `this.db` on every call, which would invalidate an in-flight query
      // launched by a concurrent caller. Per-call snapshots scoped to each
      // caller eliminate that race; this test keeps the contract locked in.
      await store.insert([
        makeChunk({ content: 'concurrent alpha content', label: 'alpha' }),
        makeChunk({ content: 'concurrent beta content', label: 'beta' }),
        makeChunk({ content: 'concurrent gamma content', label: 'gamma' }),
      ]);

      const before = store.readRefreshCount;
      const results = await Promise.all([
        store.search({ query: 'concurrent alpha' }),
        store.search({ query: 'concurrent beta' }),
        store.search({ query: 'concurrent gamma' }),
      ]);

      // Every call reopens; none fail from a sibling closing its connection.
      expect(store.readRefreshCount).toBe(before + 3);
      for (const r of results) {
        expect(r.length).toBeGreaterThan(0);
      }
    });
  });

  describe('healthCheck', () => {
    it('returns healthy for a populated index', async () => {
      await store.insert([
        makeChunk({ content: 'alpha content' }),
        makeChunk({ content: 'beta content' }),
      ]);

      const result = await store.healthCheck();

      expect(result.healthy).toBe(true);
      expect(result.dimensionMatch).toBe(true);
      expect(result.canarySearchOk).toBe(true);
      expect(result.totalChunks).toBe(2);
      expect(result.expectedDimensions).toBe(embedder.dimensions);
      expect(result.storedDimensions).toBe(embedder.dimensions);
      expect(result.issues).toEqual([]);
      expect(result.durationMs).toBeGreaterThanOrEqual(0); // totem-ignore — timing floor check, not a set count
    });

    it('returns healthy with storedDimensions null for an empty index', async () => {
      const result = await store.healthCheck();

      expect(result.healthy).toBe(true);
      expect(result.storedDimensions).toBeNull();
      expect(result.dimensionMatch).toBe(true);
      expect(result.canarySearchOk).toBe(true);
      expect(result.totalChunks).toBe(0);
      expect(result.issues).toEqual([]);
    });

    it('reports FTS availability', async () => {
      await store.insert([makeChunk({ content: 'fts test content' })]);
      await store.createFtsIndex();

      const result = await store.healthCheck();

      expect(result.healthy).toBe(true);
      expect(result.ftsAvailable).toBe(true);
    });

    it('reports ftsAvailable false when no FTS index exists', async () => {
      await store.insert([makeChunk({ content: 'no fts here' })]);

      const result = await store.healthCheck();

      expect(result.ftsAvailable).toBe(false);
    });
  });
});
