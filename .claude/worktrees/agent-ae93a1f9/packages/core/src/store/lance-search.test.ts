import { describe, expect, it, vi } from 'vitest';

import type { Embedder } from '../embedders/embedder.js';
import { runHybridSearch, runVectorSearch } from './lance-search.js';

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
    );

    expect(results).toHaveLength(2);
    expect(results[0]!.content).toBe('content-a');
    expect(results[0]!.score).toBeCloseTo(1 / (1 + 0.5));
    expect(results[1]!.content).toBe('content-b');
    expect(results[1]!.score).toBeCloseTo(1 / (1 + 1.0));
  });

  it('returns empty array when table has no matches', async () => {
    const table = mockTable({ vectorRows: [] });
    const results = await runVectorSearch(table as never, mockEmbedder(), 'query', undefined, 5);
    expect(results).toHaveLength(0);
  });

  it('passes type filter as a WHERE clause', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(table as never, mockEmbedder(), 'query', 'spec', 5);

    expect(table._vectorBuilder.where).toHaveBeenCalledOnce();
    const clause = table._vectorBuilder.where.mock.calls[0]![0] as string;
    expect(clause).toContain("`type` = 'spec'");
  });

  it('passes boundary filter as a WHERE LIKE clause', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(table as never, mockEmbedder(), 'query', undefined, 5, 'src/utils');

    expect(table._vectorBuilder.where).toHaveBeenCalledOnce();
    const clause = table._vectorBuilder.where.mock.calls[0]![0] as string;
    expect(clause).toContain("`filePath` LIKE 'src/utils%'");
  });

  it('combines type and boundary filters with AND', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(table as never, mockEmbedder(), 'query', 'code', 5, 'src/');

    const clause = table._vectorBuilder.where.mock.calls[0]![0] as string;
    expect(clause).toContain("`type` = 'code'");
    expect(clause).toContain("`filePath` LIKE 'src/%'");
    expect(clause).toContain(' AND ');
  });

  it('handles multiple boundary prefixes with OR', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(table as never, mockEmbedder(), 'query', undefined, 5, [
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
    await runVectorSearch(table as never, mockEmbedder(), 'query', undefined, 5);
    expect(table._vectorBuilder.where).not.toHaveBeenCalled();
  });

  it('escapes SQL wildcards in boundary prefixes', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(table as never, mockEmbedder(), 'query', undefined, 5, 'src/50%_off');

    const clause = table._vectorBuilder.where.mock.calls[0]![0] as string;
    // % and _ should be escaped
    expect(clause).toContain('50\\%\\_off');
  });

  it('normalizes Windows backslashes in boundary prefixes', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(table as never, mockEmbedder(), 'query', undefined, 5, 'src\\utils\\foo');

    const clause = table._vectorBuilder.where.mock.calls[0]![0] as string;
    expect(clause).toContain('src/utils/foo');
    expect(clause).not.toContain('\\\\');
  });

  it('escapes single quotes in boundary prefixes', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(table as never, mockEmbedder(), 'query', undefined, 5, "it's/a/path");

    const clause = table._vectorBuilder.where.mock.calls[0]![0] as string;
    expect(clause).toContain("it''s/a/path");
  });

  it('filters out empty boundary strings', async () => {
    const table = mockTable({ vectorRows: [] });
    await runVectorSearch(table as never, mockEmbedder(), 'query', undefined, 5, ['', 'src/']);

    const clause = table._vectorBuilder.where.mock.calls[0]![0] as string;
    expect(clause).toContain("`filePath` LIKE 'src/%'");
    expect(clause).not.toContain("LIKE '%'");
  });

  it('handles row with null _distance gracefully (score = 0)', async () => {
    const table = mockTable({
      vectorRows: [fakeRow('x', { _distance: null })],
    });
    const results = await runVectorSearch(table as never, mockEmbedder(), 'query', undefined, 5);
    expect(results[0]!.score).toBe(0);
  });

  it('parses metadata JSON from row', async () => {
    const table = mockTable({
      vectorRows: [fakeRow('m', { metadata: '{"key":"value"}' })],
    });
    const results = await runVectorSearch(table as never, mockEmbedder(), 'query', undefined, 5);
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
    );

    expect(results).toHaveLength(1);
    // Both at rank 1: score = 2 * 1/(60+1) = 2/61
    expect(results[0]!.score).toBeCloseTo(2 / 61, 6);
  });

  it('passes type filter through to both legs', async () => {
    const table = mockTable({ vectorRows: [], ftsRows: [] });
    const onWarn = vi.fn();

    await runHybridSearch(table as never, mockEmbedder(), onWarn, 'query', 'spec', 5);

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
