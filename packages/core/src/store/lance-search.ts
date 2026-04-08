import * as path from 'node:path';

import type * as lancedb from '@lancedb/lancedb';

import type { ContentType } from '../config-schema.js';
import type { Embedder } from '../embedders/embedder.js';
import type { SearchResult, SourceContext } from '../types.js';

/** RRF constant — standard value from the original RRF paper. */
const RRF_K = 60;

/**
 * Number of extra candidates to fetch per search leg during hybrid search.
 * We fetch more than `maxResults` per leg so that after RRF fusion we
 * still have enough results even when the two legs return different sets.
 */
const HYBRID_OVERFETCH_FACTOR = 3;

interface RankedRow {
  row: Record<string, unknown>;
  rank: number;
  id: string;
}

/** Pure vector search (original behavior). */
export async function runVectorSearch(
  table: lancedb.Table,
  embedder: Embedder,
  query: string,
  typeFilter: ContentType | undefined,
  maxResults: number,
  sourceContext: SourceContext,
  boundary?: string | string[],
): Promise<SearchResult[]> {
  const [queryVector] = await embedder.embed([query]);

  let q = table.vectorSearch(queryVector!).limit(maxResults);

  const whereClause = buildWhereClause(typeFilter, boundary);
  if (whereClause) q = q.where(whereClause);

  const results = await q.toArray();
  return results.map((row) => rowToSearchResult(row, sourceContext));
}

/**
 * Hybrid search: runs vector + FTS in parallel, merges with RRF.
 * Each leg fetches `maxResults * HYBRID_OVERFETCH_FACTOR` candidates
 * to give RRF enough diversity to produce `maxResults` fused results.
 */
export async function runHybridSearch(
  table: lancedb.Table,
  embedder: Embedder,
  onWarn: (msg: string) => void,
  query: string,
  typeFilter: ContentType | undefined,
  maxResults: number,
  sourceContext: SourceContext,
  boundary?: string | string[],
): Promise<SearchResult[]> {
  const fetchCount = maxResults * HYBRID_OVERFETCH_FACTOR;
  const whereClause = buildWhereClause(typeFilter, boundary);

  const [queryVector] = await embedder.embed([query]);

  // Run both legs in parallel
  const [vectorResults, ftsResults] = await Promise.all([
    runVectorLeg(table, queryVector!, whereClause, fetchCount),
    runFtsLeg(table, onWarn, query, whereClause, fetchCount),
  ]);

  // Merge with RRF
  return rrfMerge(vectorResults, ftsResults, maxResults, sourceContext);
}

async function runVectorLeg(
  table: lancedb.Table,
  queryVector: number[],
  whereClause: string | undefined,
  limit: number,
): Promise<RankedRow[]> {
  let q = table.vectorSearch(queryVector).limit(limit).withRowId();
  if (whereClause) q = q.where(whereClause);

  const rows = await q.toArray();
  return rows.map((row, rank) => ({
    row,
    rank: rank + 1,
    id: String(row['_rowid'] ?? row['id']),
  }));
}

/** FTS-only search — no embedder required. For use when embedding is unavailable (offline, no API key). */
export async function runFtsSearch(
  table: lancedb.Table,
  onWarn: (msg: string) => void,
  query: string,
  typeFilter: ContentType | undefined,
  maxResults: number,
  sourceContext: SourceContext,
  boundary?: string | string[],
): Promise<SearchResult[]> {
  const whereClause = buildWhereClause(typeFilter, boundary);
  const rows = await runFtsLeg(table, onWarn, query, whereClause, maxResults);
  return rows.map(({ row, rank }) => {
    const result = rowToSearchResult(row, sourceContext);
    // If FTS didn't provide _score, use rank-based scoring (1.0 → 0.0)
    if (row['_score'] == null) {
      result.score = 1 / rank;
    }
    return result;
  });
}

async function runFtsLeg(
  table: lancedb.Table,
  onWarn: (msg: string) => void,
  query: string,
  whereClause: string | undefined,
  limit: number,
): Promise<RankedRow[]> {
  try {
    let q = table.search(query, 'fts', 'content').withRowId();

    if (whereClause) q = q.where(whereClause);
    q = q.limit(limit);

    const rows = await q.toArray();
    return rows.map((row, rank) => ({
      row,
      rank: rank + 1,
      id: String(row['_rowid'] ?? row['id']),
    }));
  } catch (err) {
    // FTS leg failed — degrade gracefully
    const msg = err instanceof Error ? err.message : String(err);
    onWarn(`FTS search failed: ${msg}`);
    return [];
  }
}

// ─── Internal helpers ──────────────────────────────────

/** Escape a single boundary prefix for use in a SQL LIKE clause. */
function escapeBoundaryPrefix(raw: string): string {
  // Normalize Windows backslashes to forward slashes
  const normalized = raw.replace(/\\/g, '/');
  // Escape SQL LIKE wildcards (%, _), backticks, and single quotes
  return normalized
    .replace(/`/g, '\\`')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/'/g, "''");
}

/** Build a SQL WHERE clause from optional type and boundary filters. */
function buildWhereClause(
  typeFilter?: ContentType,
  boundary?: string | string[],
): string | undefined {
  const conditions: string[] = [];
  if (typeFilter) {
    const safeType = typeFilter.replace(/`/g, '\\`').replace(/'/g, "''");
    conditions.push(`\`type\` = '${safeType}'`);
  }
  // Normalize boundary to array
  const prefixes = boundary
    ? (Array.isArray(boundary) ? boundary : [boundary]).filter((b) => b.length > 0)
    : [];
  if (prefixes.length > 0) {
    const orClauses = prefixes
      .map((p) => `\`filePath\` LIKE '${escapeBoundaryPrefix(p)}%'`)
      .join(' OR ');
    conditions.push(prefixes.length > 1 ? `(${orClauses})` : orClauses);
  }
  return conditions.length > 0 ? conditions.join(' AND ') : undefined;
}

/**
 * Convert a raw LanceDB row to a SearchResult.
 *
 * `sourceContext` is **required** (mmnto/totem#1295 — CR outside-diff catch).
 * An optional context with a silent `filePath` fallback for `absoluteFilePath`
 * sent legacy callers down the wrong repo root instead of failing fast.
 * Making the parameter required is the type-level fix for that drift.
 */
function rowToSearchResult(
  row: Record<string, unknown>,
  sourceContext: SourceContext,
): SearchResult {
  // Vector search returns _distance (lower = better); FTS returns _score (higher = better)
  let score = 0;
  if (row['_distance'] != null) {
    score = 1 / (1 + (row['_distance'] as number));
  } else if (row['_score'] != null) {
    score = row['_score'] as number;
  }

  const filePath = row['filePath'] as string;
  const absoluteFilePath = path.join(sourceContext.absolutePathRoot, filePath);

  const result: SearchResult = {
    content: row['content'] as string,
    contextPrefix: row['contextPrefix'] as string,
    filePath,
    absoluteFilePath,
    type: row['type'] as ContentType,
    label: row['label'] as string,
    score,
    metadata: JSON.parse((row['metadata'] as string) || '{}') as Record<string, string>,
  };

  if (sourceContext.sourceRepo) {
    result.sourceRepo = sourceContext.sourceRepo;
  }

  return result;
}

/**
 * Reciprocal Rank Fusion — merges two ranked result lists.
 * score(d) = Σ 1 / (k + rank_in_list) for each list containing d.
 */
function rrfMerge(
  listA: RankedRow[],
  listB: RankedRow[],
  limit: number,
  sourceContext: SourceContext,
): SearchResult[] {
  const scores = new Map<string, { score: number; row: Record<string, unknown> }>();

  for (const list of [listA, listB]) {
    for (const { row, rank, id } of list) {
      const entry = scores.get(id) ?? { score: 0, row };
      entry.score += 1 / (RRF_K + rank);
      scores.set(id, entry);
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, row }) => ({ ...rowToSearchResult(row, sourceContext), score }));
}
