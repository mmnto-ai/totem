import { describe, expect, it, vi } from 'vitest';

import type { Embedder } from '../embedders/embedder.js';
import { runFtsSearch, runHybridSearch, runVectorSearch } from './lance-search.js';
import { OUT_OF_RANGE_CAUSE } from './relevance.js';

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

/**
 * Create a chainable query builder mock. Tracks the where clause and the
 * distance metric the query was issued with (mmnto-ai/totem#2738 — the metric
 * must be a recorded fact in the query, never an inherited SDK default).
 */
function mockQueryBuilder(rows: Record<string, unknown>[]) {
  const captured: { where?: string; distanceType?: string } = {};
  const builder = {
    limit: vi.fn().mockReturnThis(),
    distanceType: vi.fn((metric: string) => {
      captured.distanceType = metric;
      return builder;
    }),
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

/**
 * Warning sink for the calls that are not exercising the out-of-range warning
 * path (mmnto-ai/totem#2738 gave `runVectorSearch` an `onWarn` parameter so it
 * can report a relevance that left [0, 1]).
 */
const NO_WARN = (): void => {};

// ─── runVectorSearch ────────────────────────────────────

describe('runVectorSearch', () => {
  it('returns results mapped from LanceDB rows', async () => {
    const table = mockTable({
      vectorRows: [fakeRow('a', { _distance: 0.5 }), fakeRow('b', { _distance: 1.0 })],
    });

    const results = await runVectorSearch(
      table as never,
      mockEmbedder(),
      NO_WARN,
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
      NO_WARN,
      'query',
      undefined,
      5,
      DEFAULT_CTX,
    );
    expect(results).toHaveLength(0);
  });

  it('passes type filter as a WHERE clause', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(table as never, mockEmbedder(), NO_WARN, 'query', 'spec', 5, DEFAULT_CTX);

    expect(table._vectorBuilder.where).toHaveBeenCalledOnce();
    const clause = table._vectorBuilder.where.mock.calls[0]![0] as string;
    expect(clause).toContain("`type` = 'spec'");
  });

  it('passes boundary filter as a WHERE LIKE clause', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(
      table as never,
      mockEmbedder(),
      NO_WARN,
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
    await runVectorSearch(
      table as never,
      mockEmbedder(),
      NO_WARN,
      'query',
      'code',
      5,
      DEFAULT_CTX,
      'src/',
    );

    const clause = table._vectorBuilder.where.mock.calls[0]![0] as string;
    expect(clause).toContain("`type` = 'code'");
    expect(clause).toContain("`filePath` LIKE 'src/%'");
    expect(clause).toContain(' AND ');
  });

  it('handles multiple boundary prefixes with OR', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(
      table as never,
      mockEmbedder(),
      NO_WARN,
      'query',
      undefined,
      5,
      DEFAULT_CTX,
      ['src/a', 'src/b'],
    );

    const clause = table._vectorBuilder.where.mock.calls[0]![0] as string;
    expect(clause).toContain("`filePath` LIKE 'src/a%'");
    expect(clause).toContain(' OR ');
    expect(clause).toContain("`filePath` LIKE 'src/b%'");
  });

  it('does not call where when no filters are provided', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(
      table as never,
      mockEmbedder(),
      NO_WARN,
      'query',
      undefined,
      5,
      DEFAULT_CTX,
    );
    expect(table._vectorBuilder.where).not.toHaveBeenCalled();
  });

  it('escapes SQL wildcards in boundary prefixes', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(
      table as never,
      mockEmbedder(),
      NO_WARN,
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
      NO_WARN,
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
      NO_WARN,
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
      NO_WARN,
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
    await runVectorSearch(
      table as never,
      mockEmbedder(),
      NO_WARN,
      'query',
      undefined,
      5,
      DEFAULT_CTX,
      ['', 'src/'],
    );

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
      NO_WARN,
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
      NO_WARN,
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
      NO_WARN,
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

    const results = await runVectorSearch(
      table as never,
      mockEmbedder(),
      NO_WARN,
      'query',
      undefined,
      5,
      {
        sourceRepo: 'strategy',
        absolutePathRoot: '/d/Dev/totem-strategy',
      },
    );

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

    const results = await runVectorSearch(
      table as never,
      mockEmbedder(),
      NO_WARN,
      'query',
      undefined,
      5,
      {
        sourceRepo: '',
        absolutePathRoot: '/d/Dev/totem',
      },
    );

    expect(results[0]!.sourceRepo).toBeUndefined();
  });
});

// ─── relevance + searchMethod (mmnto-ai/totem#2463) ───────
//
// `relevance` carries the true vector-leg similarity through fusion so the
// MCP floor can distinguish weak retrieval from the RRF rank artifact in
// `score`; `searchMethod` labels which path produced each hit. These tests
// lock: (1) vector rows get relevance == score; (2) FTS-only rows never get
// relevance; (3) rrfMerge PRESERVES the vector leg's relevance while still
// overwriting score with RRF; (4) relevance NEVER perturbs the sort.

describe('relevance + searchMethod (mmnto-ai/totem#2463)', () => {
  it('runVectorSearch: relevance == 1/(1+distance) and searchMethod is "vector"', async () => {
    const table = mockTable({
      vectorRows: [fakeRow('a', { _distance: 0.25 }), fakeRow('b', { _distance: 1.0 })],
    });

    const results = await runVectorSearch(
      table as never,
      mockEmbedder(),
      NO_WARN,
      'query',
      undefined,
      5,
      DEFAULT_CTX,
    );

    expect(results[0]!.relevance).toBeCloseTo(1 / 1.25, 6);
    expect(results[0]!.relevance).toBeCloseTo(results[0]!.score, 6);
    expect(results[0]!.searchMethod).toBe('vector');
    expect(results[1]!.relevance).toBeCloseTo(1 / 2.0, 6);
    expect(results[1]!.searchMethod).toBe('vector');
  });

  it('runVectorSearch: a null _distance yields no relevance signal (absent, not zero)', async () => {
    const table = mockTable({ vectorRows: [fakeRow('x', { _distance: null })] });
    const results = await runVectorSearch(
      table as never,
      mockEmbedder(),
      NO_WARN,
      'query',
      undefined,
      5,
      DEFAULT_CTX,
    );
    expect(results[0]!.relevance).toBeUndefined();
    expect(results[0]!.score).toBe(0);
  });

  it('runFtsSearch: FTS-only rows carry no relevance and searchMethod is "fts"', async () => {
    const table = mockTable({
      ftsRows: [
        fakeRow('a', { _distance: undefined, _score: 3.1 }),
        fakeRow('b', { _distance: undefined, _score: 1.4 }),
      ],
    });
    const results = await runFtsSearch(
      table as never,
      () => {},
      'query',
      undefined,
      5,
      DEFAULT_CTX,
    );

    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.relevance).toBeUndefined();
      expect(r.searchMethod).toBe('fts');
    }
  });

  it('runHybridSearch: rrfMerge preserves the vector leg relevance and stamps "hybrid"', async () => {
    // 'a' is in BOTH legs; the vector row (retained first) has _distance 0.9,
    // the fts row a different _distance — the merged relevance must come from
    // the VECTOR leg (0.9 → ~0.526), never the fts row (~0.909).
    const vectorRows = [fakeRow('a', { _distance: 0.9 }), fakeRow('b', { _distance: 0.0 })];
    const ftsRows = [
      fakeRow('a', { _distance: 0.1 }),
      fakeRow('c', { _distance: undefined, _score: 5 }),
    ];
    const table = mockTable({ vectorRows, ftsRows });

    const results = await runHybridSearch(
      table as never,
      mockEmbedder(),
      () => {},
      'query',
      undefined,
      10,
      DEFAULT_CTX,
    );

    const a = results.find((r) => r.content === 'content-a')!;
    const c = results.find((r) => r.content === 'content-c')!;

    // Vector-leg relevance survived fusion (NOT the fts row's 1/1.1 ≈ 0.909).
    expect(a.relevance).toBeCloseTo(1 / 1.9, 6);
    // score was still overwritten with RRF (2/61 for a doc in both legs).
    expect(a.score).toBeCloseTo(2 / 61, 6);
    expect(a.searchMethod).toBe('hybrid');
    // 'c' appeared only in the FTS leg (no vector row) → no relevance.
    expect(c.relevance).toBeUndefined();
    expect(c.searchMethod).toBe('hybrid');
  });

  it('runHybridSearch: relevance never perturbs RRF ordering (sort is score-only)', async () => {
    // 'a' (both legs → RRF 2/61) has LOWER relevance (~0.526) than 'b'
    // (vector-only rank 2 → RRF 1/62) which has relevance 1.0. If relevance
    // leaked into the sort key, 'b' would jump ahead — it must not.
    const vectorRows = [fakeRow('a', { _distance: 0.9 }), fakeRow('b', { _distance: 0.0 })];
    const ftsRows = [fakeRow('a', { _distance: 0.9 })];
    const table = mockTable({ vectorRows, ftsRows });

    const results = await runHybridSearch(
      table as never,
      mockEmbedder(),
      () => {},
      'query',
      undefined,
      10,
      DEFAULT_CTX,
    );

    expect(results.map((r) => r.content)).toEqual(['content-a', 'content-b']);
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
    // The higher-relevance doc is deliberately ranked SECOND.
    expect(results[1]!.relevance).toBeGreaterThan(results[0]!.relevance!);
  });
});

// ─── metric-bound relevance (mmnto-ai/totem#2738) ─────────
//
// The relevance normalization is bound to a NAMED metric that the query itself
// carries: both vector query sites chain `.distanceType('l2')` so the metric is
// a recorded fact rather than an inherited SDK default. A relevance that leaves
// [0, 1] is a signal about the embedder (non-unit vectors), so it warns ONCE
// per query — it never throws and never filters a row.

describe('metric-bound relevance (mmnto-ai/totem#2738)', () => {
  it('runVectorSearch issues the query with distanceType "l2"', async () => {
    const table = mockTable({ vectorRows: [fakeRow('a')] });

    await runVectorSearch(
      table as never,
      mockEmbedder(),
      NO_WARN,
      'query',
      undefined,
      5,
      DEFAULT_CTX,
    );

    expect(table._vectorBuilder.distanceType).toHaveBeenCalledWith('l2');
    expect(table._vectorBuilder._captured.distanceType).toBe('l2');
  });

  it('runHybridSearch issues its vector leg with distanceType "l2"', async () => {
    const table = mockTable({ vectorRows: [fakeRow('a')], ftsRows: [fakeRow('b')] });

    await runHybridSearch(
      table as never,
      mockEmbedder(),
      NO_WARN,
      'query',
      undefined,
      5,
      DEFAULT_CTX,
    );

    expect(table._vectorBuilder.distanceType).toHaveBeenCalledWith('l2');
    expect(table._vectorBuilder._captured.distanceType).toBe('l2');
  });

  it('warns once on an out-of-range relevance and still returns the row', async () => {
    // A negative _distance is the ONLY way an l2 relevance can leave [0, 1]:
    // squared L2 is >= 0 by construction, so 1/(1+d) is in (0, 1] for every
    // value the SDK can legally return. That makes a breach here an SDK or data
    // fault, NOT a non-unit-norm embedder — the warning must say so (F1).
    const table = mockTable({ vectorRows: [fakeRow('a', { _distance: -0.5 })] });
    const onWarn = vi.fn();

    const results = await runVectorSearch(
      table as never,
      mockEmbedder(),
      onWarn,
      'query',
      undefined,
      5,
      DEFAULT_CTX,
    );

    expect(onWarn).toHaveBeenCalledOnce();
    const msg = onWarn.mock.calls[0]![0] as string;
    expect(msg).toContain('1 vector hit(s) carried a relevance outside [0, 1]');
    expect(msg).toContain('under metric "l2"');
    expect(msg).toContain('sample 2');
    // The cause is metric-specific (F1): under l2 it is a fault, and the
    // non-unit-norm cause — true for cosine/dot — must NOT be named here.
    expect(msg).toContain(OUT_OF_RANGE_CAUSE.l2);
    expect(msg).toContain('which squared L2 cannot produce');
    expect(msg).not.toContain('unit-norm');

    // The row is RETURNED, not filtered, and carries its computed relevance.
    expect(results).toHaveLength(1);
    expect(results[0]!.relevance).toBeCloseTo(2, 10);
    expect(results[0]!.score).toBeCloseTo(2, 10);
  });

  it('warns exactly ONCE per query naming the count when two rows are out of range', async () => {
    const table = mockTable({
      vectorRows: [
        fakeRow('a', { _distance: -0.5 }),
        fakeRow('b', { _distance: -0.75 }),
        fakeRow('c', { _distance: 0.3096 }),
      ],
    });
    const onWarn = vi.fn();

    const results = await runVectorSearch(
      table as never,
      mockEmbedder(),
      onWarn,
      'query',
      undefined,
      5,
      DEFAULT_CTX,
    );

    expect(onWarn).toHaveBeenCalledOnce();
    expect(onWarn.mock.calls[0]![0]).toContain('2 vector hit(s)');
    expect(results).toHaveLength(3);
    // The in-range row is untouched — the R1-measured pair maps to ~0.7636.
    expect(results[2]!.relevance).toBeCloseTo(0.7636, 4);
  });

  it('does not warn when every relevance is inside [0, 1]', async () => {
    const table = mockTable({
      vectorRows: [fakeRow('a', { _distance: 0 }), fakeRow('b', { _distance: 4 })],
    });
    const onWarn = vi.fn();

    const results = await runVectorSearch(
      table as never,
      mockEmbedder(),
      onWarn,
      'query',
      undefined,
      5,
      DEFAULT_CTX,
    );

    expect(onWarn).not.toHaveBeenCalled();
    // The unit-norm bounds: d = 0 → 1, d = 4 → 0.2.
    expect(results[0]!.relevance).toBe(1);
    expect(results[1]!.relevance).toBeCloseTo(0.2, 10);
  });

  it('runHybridSearch warns once for an out-of-range vector-leg row', async () => {
    const table = mockTable({
      vectorRows: [fakeRow('a', { _distance: -0.5 })],
      ftsRows: [fakeRow('b', { _distance: undefined, _score: 3 })],
    });
    const onWarn = vi.fn();

    const results = await runHybridSearch(
      table as never,
      mockEmbedder(),
      onWarn,
      'query',
      undefined,
      5,
      DEFAULT_CTX,
    );

    const rangeWarnings = onWarn.mock.calls.filter((call) =>
      String(call[0]).includes('carried a relevance outside [0, 1]'),
    );
    expect(rangeWarnings).toHaveLength(1);
    expect(String(rangeWarnings[0]![0])).toContain('under metric "l2"');
    expect(results.find((r) => r.content === 'content-a')!.relevance).toBeCloseTo(2, 10);
  });

  it('runFtsSearch emits no range warning — FTS rows carry no relevance', async () => {
    const table = mockTable({
      ftsRows: [fakeRow('a', { _distance: undefined, _score: 3.1 })],
    });
    const onWarn = vi.fn();

    const results = await runFtsSearch(table as never, onWarn, 'query', undefined, 5, DEFAULT_CTX);

    expect(results[0]!.relevance).toBeUndefined();
    expect(onWarn).not.toHaveBeenCalled();
  });

  it('runHybridSearch tallies the vector leg BEFORE fusion, not the survivors (F3)', async () => {
    // Three vector rows, two of them out of range, but `maxResults: 1` means
    // RRF returns ONE result. Counting at the row-mapping site would have
    // reported whatever survived the slice; the count must be 2 — every row the
    // metric was applied to.
    const vectorRows = [
      fakeRow('v0', { _distance: 0.3 }),
      fakeRow('v1', { _distance: -0.5 }),
      fakeRow('v2', { _distance: -0.9 }),
    ];
    const ftsRows = [fakeRow('f0', { _distance: undefined, _score: 4 })];
    const table = mockTable({ vectorRows, ftsRows });
    const onWarn = vi.fn();

    const results = await runHybridSearch(
      table as never,
      mockEmbedder(),
      onWarn,
      'query',
      undefined,
      1,
      DEFAULT_CTX,
    );

    expect(results).toHaveLength(1);
    expect(onWarn).toHaveBeenCalledOnce();
    const msg = onWarn.mock.calls[0]![0] as string;
    expect(msg).toContain('2 vector hit(s)');
    // Sample is the FIRST breaching raw row: _distance -0.5 → 1/0.5 = 2.
    expect(msg).toContain('sample 2');
  });
});

// ─── non-finite / non-numeric `_distance` (mmnto-ai/totem#2738, F4) ────
//
// Relevance is computed only for a FINITE NUMBER `_distance`. Anything else —
// NaN, ±Infinity, a non-numeric value — yields NO relevance at all and falls
// through to the `_score` branch (or 0). Before #2738 those inputs produced a
// NaN or a 0 relevance; absence is the honest record, but it is a CHANGE:
// such a hit is floor-exempt in `totem spec` (no vector leg = no signal to
// floor), so each input class is pinned here.

describe('non-finite `_distance` yields no relevance (mmnto-ai/totem#2738, F4)', () => {
  async function searchOneRow(overrides: Record<string, unknown>) {
    const table = mockTable({ vectorRows: [fakeRow('a', overrides)] });
    const onWarn = vi.fn();
    const results = await runVectorSearch(
      table as never,
      mockEmbedder(),
      onWarn,
      'query',
      undefined,
      5,
      DEFAULT_CTX,
    );
    return { result: results[0]!, onWarn };
  }

  it('NaN: no relevance, score 0, no warning', async () => {
    const { result, onWarn } = await searchOneRow({ _distance: Number.NaN });
    expect(result.relevance).toBeUndefined();
    expect(result.score).toBe(0);
    expect(onWarn).not.toHaveBeenCalled();
  });

  it('Infinity: no relevance, score 0, no warning', async () => {
    const { result, onWarn } = await searchOneRow({ _distance: Number.POSITIVE_INFINITY });
    expect(result.relevance).toBeUndefined();
    expect(result.score).toBe(0);
    expect(onWarn).not.toHaveBeenCalled();
  });

  it('a non-numeric _distance ("0.5"): no relevance, score 0 — never coerced', async () => {
    const { result, onWarn } = await searchOneRow({ _distance: '0.5' });
    expect(result.relevance).toBeUndefined();
    expect(result.score).toBe(0);
    expect(onWarn).not.toHaveBeenCalled();
  });

  it('Infinity alongside a _score: falls through to the FTS score branch', async () => {
    const { result } = await searchOneRow({ _distance: Number.POSITIVE_INFINITY, _score: 7 });
    expect(result.relevance).toBeUndefined();
    expect(result.score).toBe(7);
  });
});
