import { describe, expect, it, vi } from 'vitest';

import type { Embedder } from '../embedders/embedder.js';
import { runFtsSearch, runHybridSearch, runVectorSearch } from './lance-search.js';

// ─── Mock helpers ───────────────────────────────────────

/** Build a fake LanceDB row with fields that rowToSearchResult expects. */
function fakeRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    content: `content-${id}`,
    contextPrefix: `prefix-${id}`,
    filePath: `src/${id}.ts`,
    type: 'code',
    label: `label-${id}`,
    metadata: '{}',
    _distance: 0.1,
    _rowid: id,
    ...overrides,
  };
}

/** Create a chainable query builder mock. Tracks the where clause. */
function mockQueryBuilder(rows: Record<string, unknown>[]) {
  const captured: { where?: string } = {};
  const builder = {
    limit: vi.fn().mockReturnThis(),
    where: vi.fn((clause: string) => {
      captured.where = clause;
      return builder;
    }),
    withRowId: vi.fn().mockReturnThis(),
    toArray: vi.fn(async () => rows),
    _captured: captured,
  };
  return builder;
}

/** Create a mock LanceDB table. */
function mockTable(opts: {
  vectorRows?: Record<string, unknown>[];
  ftsRows?: Record<string, unknown>[];
  ftsError?: Error;
}) {
  const vectorBuilder = mockQueryBuilder(opts.vectorRows ?? []);
  const ftsBuilder = mockQueryBuilder(opts.ftsRows ?? []);

  if (opts.ftsError) {
    ftsBuilder.toArray = vi.fn(async () => {
      throw opts.ftsError;
    });
  }

  return {
    vectorSearch: vi.fn(() => vectorBuilder),
    search: vi.fn(() => ftsBuilder),
    _vectorBuilder: vectorBuilder,
    _ftsBuilder: ftsBuilder,
  };
}

/** Create a mock embedder returning a deterministic vector. */
function mockEmbedder(vec: number[] = [1, 0, 0]): Embedder {
  return {
    dimensions: vec.length,
    embed: async (texts: string[]) => texts.map(() => vec),
  };
}

/**
 * Default SourceContext for tests that don't specifically exercise the
 * source-tagging path. Required by the search functions since
 * mmnto/totem#1295 made sourceContext a required parameter (removing
 * the silent `filePath` fallback that CR flagged as Tenet 4 drift).
 * Tests that DO care about the tagging live in the "source context
 * tagging" describe block and pass their own context.
 */
const DEFAULT_CTX = { absolutePathRoot: '/test' };

// ─── runVectorSearch ────────────────────────────────────

describe('runVectorSearch', () => {
  it('returns results mapped from LanceDB rows', async () => {
    const table = mockTable({
      vectorRows: [fakeRow('a', { _distance: 0.5 }), fakeRow('b', { _distance: 1.0 })],
    });

    const results = await runVectorSearch(
      table as never,
      mockEmbedder(),
      'test query',
      undefined,
      10,
      DEFAULT_CTX,
    );

    expect(results).toHaveLength(2);
    expect(results[0]!.content).toBe('content-a');
    expect(results[0]!.score).toBeCloseTo(1 / (1 + 0.5));
    expect(results[1]!.content).toBe('content-b');
    expect(results[1]!.score).toBeCloseTo(1 / (1 + 1.0));
  });

  it('returns empty array when table has no matches', async () => {
    const table = mockTable({ vectorRows: [] });
    const results = await runVectorSearch(
      table as never,
      mockEmbedder(),
      'query',
      undefined,
      5,
      DEFAULT_CTX,
    );
    expect(results).toHaveLength(0);
  });

  it('passes type filter as a WHERE clause', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(table as never, mockEmbedder(), 'query', 'spec', 5, DEFAULT_CTX);

    expect(table._vectorBuilder.where).toHaveBeenCalledOnce();
    const clause = table._vectorBuilder.where.mock.calls[0]![0] as string;
    expect(clause).toContain("`type` = 'spec'");
  });

  it('passes boundary filter as a WHERE LIKE clause', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(
      table as never,
      mockEmbedder(),
      'query',
      undefined,
      5,
      DEFAULT_CTX,
      'src/utils',
    );

    expect(table._vectorBuilder.where).toHaveBeenCalledOnce();
    const clause = table._vectorBuilder.where.mock.calls[0]![0] as string;
    expect(clause).toContain("`filePath` LIKE 'src/utils%'");
  });

  it('combines type and boundary filters with AND', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(table as never, mockEmbedder(), 'query', 'code', 5, DEFAULT_CTX, 'src/');

    const clause = table._vectorBuilder.where.mock.calls[0]![0] as string;
    expect(clause).toContain("`type` = 'code'");
    expect(clause).toContain("`filePath` LIKE 'src/%'");
    expect(clause).toContain(' AND ');
  });

  it('handles multiple boundary prefixes with OR', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(table as never, mockEmbedder(), 'query', undefined, 5, DEFAULT_CTX, [
      'src/a',
      'src/b',
    ]);

    const clause = table._vectorBuilder.where.mock.calls[0]![0] as string;
    expect(clause).toContain("`filePath` LIKE 'src/a%'");
    expect(clause).toContain(' OR ');
    expect(clause).toContain("`filePath` LIKE 'src/b%'");
  });

  it('does not call where when no filters are provided', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(table as never, mockEmbedder(), 'query', undefined, 5, DEFAULT_CTX);
    expect(table._vectorBuilder.where).not.toHaveBeenCalled();
  });

  it('escapes SQL wildcards in boundary prefixes', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(
      table as never,
      mockEmbedder(),
      'query',
      undefined,
      5,
      DEFAULT_CTX,
      'src/50%_off',
    );

    const clause = table._vectorBuilder.where.mock.calls[0]![0] as string;
    // % and _ should be escaped
    expect(clause).toContain('50\\%\\_off');
  });

  it('normalizes Windows backslashes in boundary prefixes', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(
      table as never,
      mockEmbedder(),
      'query',
      undefined,
      5,
      DEFAULT_CTX,
      'src\\utils\\foo',
    );

    const clause = table._vectorBuilder.where.mock.calls[0]![0] as string;
    expect(clause).toContain('src/utils/foo');
    expect(clause).not.toContain('\\\\');
  });

  it('does not escape backticks in boundary prefixes (not required for single-quoted literals)', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(
      table as never,
      mockEmbedder(),
      'query',
      undefined,
      5,
      DEFAULT_CTX,
      'src/my`path',
    );

    const clause = table._vectorBuilder.where.mock.calls[0]![0] as string;
    expect(clause).toContain('src/my`path');
    expect(clause).not.toContain('src/my\\`path');
  });

  it('escapes single quotes in boundary prefixes', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(
      table as never,
      mockEmbedder(),
      'query',
      undefined,
      5,
      DEFAULT_CTX,
      "it's/a/path",
    );

    const clause = table._vectorBuilder.where.mock.calls[0]![0] as string;
    expect(clause).toContain("it''s/a/path");
  });

  it('filters out empty boundary strings', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(table as never, mockEmbedder(), 'query', undefined, 5, DEFAULT_CTX, [
      '',
      'src/',
    ]);

    const clause = table._vectorBuilder.where.mock.calls[0]![0] as string;
    expect(clause).toContain("`filePath` LIKE 'src/%'");
    expect(clause).not.toContain("LIKE '%'");
  });

  it('handles row with null _distance gracefully (score = 0)', async () => {
    const table = mockTable({
      vectorRows: [fakeRow('x', { _distance: null })],
    });
    const results = await runVectorSearch(
      table as never,
      mockEmbedder(),
      'query',
      undefined,
      5,
      DEFAULT_CTX,
    );
    expect(results[0]!.score).toBe(0);
  });

  it('parses metadata JSON from row', async () => {
    const table = mockTable({
      vectorRows: [fakeRow('m', { metadata: '{"key":"value"}' })],
    });
    const results = await runVectorSearch(
      table as never,
      mockEmbedder(),
      'query',
      undefined,
      5,
      DEFAULT_CTX,
    );
    expect(results[0]!.metadata).toEqual({ key: 'value' });
  });
});

// ─── runHybridSearch (exercises rrfMerge) ───────────────

describe('runHybridSearch', () => {
  it('merges vector and FTS results via RRF', async () => {
    // Item 'a' appears in both lists, 'b' only in vector, 'c' only in FTS
    const vectorRows = [fakeRow('a'), fakeRow('b')];
    const ftsRows = [fakeRow('a'), fakeRow('c')];

    const table = mockTable({ vectorRows, ftsRows });
    const onWarn = vi.fn();

    const results = await runHybridSearch(
      table as never,
      mockEmbedder(),
      onWarn,
      'query',
      undefined,
      10,
      DEFAULT_CTX,
    );

    // 'a' appears in both lists, so it should have the highest RRF score
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results[0]!.content).toBe('content-a');

    // 'a' score = 1/(60+1) + 1/(60+1) = 2/61
    const expectedTopScore = 2 / 61;
    expect(results[0]!.score).toBeCloseTo(expectedTopScore, 6);

    // 'b' and 'c' each appear in one list at rank 2: score = 1/(60+2) = 1/62
    const singleListScore = 1 / 62;
    const secondItem = results[1]!;
    expect(secondItem.score).toBeCloseTo(singleListScore, 6);
  });

  it('returns only vector results when FTS leg fails', async () => {
    const vectorRows = [fakeRow('a'), fakeRow('b')];
    const table = mockTable({
      vectorRows,
      ftsError: new Error('FTS index not found'),
    });
    const onWarn = vi.fn();

    const results = await runHybridSearch(
      table as never,
      mockEmbedder(),
      onWarn,
      'query',
      undefined,
      10,
      DEFAULT_CTX,
    );

    expect(results).toHaveLength(2);
    expect(onWarn).toHaveBeenCalledOnce();
    expect(onWarn.mock.calls[0]![0]).toContain('FTS search failed');
  });

  it('returns empty array when both legs return empty', async () => {
    const table = mockTable({ vectorRows: [], ftsRows: [] });
    const onWarn = vi.fn();

    const results = await runHybridSearch(
      table as never,
      mockEmbedder(),
      onWarn,
      'query',
      undefined,
      10,
      DEFAULT_CTX,
    );

    expect(results).toHaveLength(0);
  });

  it('returns results when only FTS leg has results (vector empty)', async () => {
    const table = mockTable({
      vectorRows: [],
      ftsRows: [fakeRow('x')],
    });
    const onWarn = vi.fn();

    const results = await runHybridSearch(
      table as never,
      mockEmbedder(),
      onWarn,
      'query',
      undefined,
      10,
      DEFAULT_CTX,
    );

    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe('content-x');
  });

  it('respects the limit parameter (RRF truncation)', async () => {
    // Put 5 items in each list
    const vectorRows = Array.from({ length: 5 }, (_, i) => fakeRow(`v${i}`));
    const ftsRows = Array.from({ length: 5 }, (_, i) => fakeRow(`f${i}`));

    const table = mockTable({ vectorRows, ftsRows });
    const onWarn = vi.fn();

    const results = await runHybridSearch(
      table as never,
      mockEmbedder(),
      onWarn,
      'query',
      undefined,
      3,
      DEFAULT_CTX,
    );

    expect(results).toHaveLength(3);
  });

  it('ranks items appearing in both lists higher than single-list items', async () => {
    // 'shared' appears in both at different ranks, 'solo' in vector only
    const vectorRows = [fakeRow('solo'), fakeRow('shared')];
    const ftsRows = [fakeRow('shared')];

    const table = mockTable({ vectorRows, ftsRows });
    const onWarn = vi.fn();

    const results = await runHybridSearch(
      table as never,
      mockEmbedder(),
      onWarn,
      'query',
      undefined,
      10,
      DEFAULT_CTX,
    );

    // 'shared' = 1/(60+2) + 1/(60+1) = 1/62 + 1/61
    // 'solo'   = 1/(60+1) = 1/61
    // shared should rank higher
    const sharedIdx = results.findIndex((r) => r.content === 'content-shared');
    const soloIdx = results.findIndex((r) => r.content === 'content-solo');
    expect(sharedIdx).toBeLessThan(soloIdx);
  });

  it('computes correct RRF scores with single-item lists', async () => {
    const vectorRows = [fakeRow('only')];
    const ftsRows = [fakeRow('only')];

    const table = mockTable({ vectorRows, ftsRows });
    const onWarn = vi.fn();

    const results = await runHybridSearch(
      table as never,
      mockEmbedder(),
      onWarn,
      'query',
      undefined,
      10,
      DEFAULT_CTX,
    );

    expect(results).toHaveLength(1);
    // Both at rank 1: score = 2 * 1/(60+1) = 2/61
    expect(results[0]!.score).toBeCloseTo(2 / 61, 6);
  });

  it('passes type filter through to both legs', async () => {
    const table = mockTable({ vectorRows: [], ftsRows: [] });
    const onWarn = vi.fn();

    await runHybridSearch(table as never, mockEmbedder(), onWarn, 'query', 'spec', 5, DEFAULT_CTX);

    // Vector leg should get a where clause
    expect(table._vectorBuilder.where).toHaveBeenCalled();
    const vectorClause = table._vectorBuilder.where.mock.calls[0]![0] as string;
    expect(vectorClause).toContain("`type` = 'spec'");

    // FTS leg should also get a where clause
    expect(table._ftsBuilder.where).toHaveBeenCalled();
    const ftsClause = table._ftsBuilder.where.mock.calls[0]![0] as string;
    expect(ftsClause).toContain("`type` = 'spec'");
  });
});

// ─── runFtsSearch (FTS-only, no embedder) ─────────────────

describe('runFtsSearch', () => {
  it('returns results from FTS without requiring an embedder', async () => {
    const ftsRows = [
      fakeRow('a', { _distance: undefined }),
      fakeRow('b', { _distance: undefined }),
    ];
    const table = mockTable({ ftsRows });
    const onWarn = vi.fn();

    const results = await runFtsSearch(
      table as never,
      onWarn,
      'test query',
      undefined,
      10,
      DEFAULT_CTX,
    );

    expect(results).toHaveLength(2);
    expect(results[0]!.content).toBe('content-a');
    expect(results[1]!.content).toBe('content-b');
  });

  it('assigns rank-based scores when no _score or _distance is present', async () => {
    const ftsRows = [
      fakeRow('a', { _distance: undefined, _score: undefined }),
      fakeRow('b', { _distance: undefined, _score: undefined }),
    ];
    const table = mockTable({ ftsRows });
    const onWarn = vi.fn();

    const results = await runFtsSearch(table as never, onWarn, 'query', undefined, 10, DEFAULT_CTX);

    // Rank 1 → score 1/1 = 1.0, Rank 2 → score 1/2 = 0.5
    expect(results[0]!.score).toBeCloseTo(1.0);
    expect(results[1]!.score).toBeCloseTo(0.5);
  });

  it('uses _score from BM25 when available', async () => {
    const ftsRows = [fakeRow('a', { _distance: undefined, _score: 2.5 })];
    const table = mockTable({ ftsRows });
    const onWarn = vi.fn();

    const results = await runFtsSearch(table as never, onWarn, 'query', undefined, 10, DEFAULT_CTX);

    expect(results[0]!.score).toBeCloseTo(2.5);
  });

  it('returns empty on FTS failure and warns', async () => {
    const table = mockTable({ ftsError: new Error('no FTS index') });
    const onWarn = vi.fn();

    const results = await runFtsSearch(table as never, onWarn, 'query', undefined, 10, DEFAULT_CTX);

    expect(results).toHaveLength(0);
    expect(onWarn).toHaveBeenCalledOnce();
    expect(onWarn.mock.calls[0]![0]).toContain('FTS search failed');
  });

  it('passes type filter as WHERE clause', async () => {
    const table = mockTable({ ftsRows: [] });
    const onWarn = vi.fn();

    await runFtsSearch(table as never, onWarn, 'query', 'lesson', 5, DEFAULT_CTX);

    expect(table._ftsBuilder.where).toHaveBeenCalled();
    const clause = table._ftsBuilder.where.mock.calls[0]![0] as string;
    expect(clause).toContain("`type` = 'lesson'");
  });

  it('passes boundary filter as WHERE LIKE clause', async () => {
    const table = mockTable({ ftsRows: [] });
    const onWarn = vi.fn();

    await runFtsSearch(
      table as never,
      onWarn,
      'query',
      undefined,
      5,
      { absolutePathRoot: '/test' },
      'packages/core',
    );

    expect(table._ftsBuilder.where).toHaveBeenCalled();
    const clause = table._ftsBuilder.where.mock.calls[0]![0] as string;
    expect(clause).toContain("`filePath` LIKE 'packages/core%'");
  });
});

// ─── Source context tagging (mmnto/totem#1294 Phase 1 + #1295 required-context) ──
//
// Phase 1 originally tested a "no sourceContext" fallback where
// `absoluteFilePath === filePath`. CR flagged that test on PR #1295 as
// locking in silent drift — legacy callers that forgot the context would
// keep looking healthy instead of failing fast. The fix was to make
// sourceContext required at the type level (see mmnto/totem#1295 review
// cycle). The tests below now ONLY exercise the required-context path.

describe('source context tagging', () => {
  it('runVectorSearch: primary sourceContext (no sourceRepo) → absoluteFilePath joined, sourceRepo absent', async () => {
    const table = mockTable({
      vectorRows: [fakeRow('a', { _distance: 0.5, filePath: 'src/foo.ts' })],
    });

    const results = await runVectorSearch(
      table as never,
      mockEmbedder(),
      'query',
      undefined,
      5,
      { absolutePathRoot: '/d/Dev/totem' }, // primary — no sourceRepo tag
    );

    expect(results).toHaveLength(1);
    expect(results[0]!.filePath).toBe('src/foo.ts');
    // path.join normalizes to the platform separator; check with posix + win32 forms
    expect(results[0]!.absoluteFilePath).toMatch(/^[/\\]d[/\\]Dev[/\\]totem[/\\]src[/\\]foo\.ts$/);
    expect(results[0]!.sourceRepo).toBeUndefined();
  });

  it('runVectorSearch: linked sourceContext → absoluteFilePath joined AND sourceRepo set', async () => {
    const table = mockTable({
      vectorRows: [fakeRow('a', { _distance: 0.5, filePath: 'adr/adr-001.md' })],
    });

    const results = await runVectorSearch(table as never, mockEmbedder(), 'query', undefined, 5, {
      sourceRepo: 'strategy',
      absolutePathRoot: '/d/Dev/totem-strategy',
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.filePath).toBe('adr/adr-001.md');
    expect(results[0]!.absoluteFilePath).toMatch(
      /^[/\\]d[/\\]Dev[/\\]totem-strategy[/\\]adr[/\\]adr-001\.md$/,
    );
    expect(results[0]!.sourceRepo).toBe('strategy');
  });

  it('runHybridSearch: sourceContext flows through RRF merge to final results', async () => {
    const table = mockTable({
      vectorRows: [fakeRow('a', { _distance: 0.5, filePath: 'src/foo.ts' })],
      ftsRows: [fakeRow('a', { _score: 10, filePath: 'src/foo.ts' })],
    });

    const results = await runHybridSearch(
      table as never,
      mockEmbedder(),
      () => {},
      'query',
      undefined,
      5,
      { sourceRepo: 'playground', absolutePathRoot: '/d/Dev/totem-playground' },
    );

    // RRF merges the same row from both legs — should produce one result
    expect(results).toHaveLength(1);
    expect(results[0]!.sourceRepo).toBe('playground');
    expect(results[0]!.absoluteFilePath).toMatch(
      /^[/\\]d[/\\]Dev[/\\]totem-playground[/\\]src[/\\]foo\.ts$/,
    );
  });

  it('runFtsSearch: sourceContext threads through FTS-only path', async () => {
    const table = mockTable({
      ftsRows: [fakeRow('a', { _score: 10, filePath: 'proposals/active/215-mesh.md' })],
    });

    const results = await runFtsSearch(table as never, () => {}, 'mesh query', undefined, 5, {
      sourceRepo: 'strategy',
      absolutePathRoot: '/d/Dev/totem-strategy',
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.sourceRepo).toBe('strategy');
    expect(results[0]!.filePath).toBe('proposals/active/215-mesh.md');
    expect(results[0]!.absoluteFilePath).toMatch(
      /^[/\\]d[/\\]Dev[/\\]totem-strategy[/\\]proposals[/\\]active[/\\]215-mesh\.md$/,
    );
  });

  it('runVectorSearch: sourceRepo of empty string is treated as absent', async () => {
    // Edge case: someone passes sourceRepo: '' — should NOT set the tag
    // (mirrors the truthy check in rowToSearchResult)
    const table = mockTable({
      vectorRows: [fakeRow('a', { _distance: 0.5, filePath: 'src/foo.ts' })],
    });

    const results = await runVectorSearch(table as never, mockEmbedder(), 'query', undefined, 5, {
      sourceRepo: '',
      absolutePathRoot: '/d/Dev/totem',
    });

    expect(results[0]!.sourceRepo).toBeUndefined();
  });
});
