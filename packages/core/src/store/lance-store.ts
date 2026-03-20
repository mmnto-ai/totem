import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';

import * as lancedb from '@lancedb/lancedb';

import type { ContentType } from '../config-schema.js';
import type { Embedder } from '../embedders/embedder.js';
import type {
  Chunk,
  HealthCheckResult,
  SearchOptions,
  SearchResult,
  StoredChunk,
} from '../types.js';
import { TOTEM_TABLE_NAME } from './lance-schema.js';

/** RRF constant — standard value from the original RRF paper. */
const RRF_K = 60;

/**
 * Number of extra candidates to fetch per search leg during hybrid search.
 * We fetch more than `maxResults` per leg so that after RRF fusion we
 * still have enough results even when the two legs return different sets.
 */
const HYBRID_OVERFETCH_FACTOR = 3;

export class LanceStore {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private dbPath: string;
  private embedder: Embedder;
  private hasFtsIndex = false;
  private onWarn: (msg: string) => void;

  constructor(dbPath: string, embedder: Embedder, onWarn?: (msg: string) => void) {
    this.dbPath = dbPath;
    this.embedder = embedder;
    this.onWarn = onWarn ?? (() => {});
  }

  /**
   * Connect to LanceDB. Auto-heals on version mismatch, corruption,
   * or embedder dimension change by deleting the index and signaling
   * that a full rebuild is needed.
   */
  async connect(): Promise<void> {
    try {
      this.db = await lancedb.connect(this.dbPath);

      const tableNames = await this.db.tableNames();
      if (tableNames.includes(TOTEM_TABLE_NAME)) {
        this.table = await this.db.openTable(TOTEM_TABLE_NAME);

        // Check for embedder dimension mismatch (#548)
        if (this.table && (await this.hasDimensionMismatch())) {
          this.onWarn(
            `[Totem] Embedding dimensions changed. Rebuilding index... Run \`totem sync --full\` if this persists.`,
          );
          await this.nukeAndReset();
          return;
        }

        await this.detectFtsIndex();
      }
    } catch (err) {
      // Auto-heal: version mismatch, corruption, or schema incompatibility (#500)
      if (this.isHealableError(err)) {
        this.onWarn(`[Totem] Index format incompatible. Upgrading index...`);
        await this.nukeAndReset();
        return;
      }
      throw err;
    }
  }

  /** Check if the stored vector dimensions differ from the current embedder. */
  private async hasDimensionMismatch(): Promise<boolean> {
    if (!this.table) return false;
    // Let query errors bubble up to connect()'s catch block for auto-healing
    const sample = await this.table.query().limit(1).toArray();
    if (sample.length === 0) return false;
    const row = sample[0] as Record<string, unknown>;
    const vec = row['vector'];
    if (Array.isArray(vec)) {
      return vec.length !== this.embedder.dimensions;
    }
    return false;
  }

  /** Detect errors that warrant auto-healing (nuke + rebuild). */
  private isHealableError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const msg = err.message.toLowerCase();
    return (
      msg.includes('version mismatch') ||
      msg.includes('data corruption') ||
      msg.includes('invalid schema') ||
      msg.includes('lance error') ||
      msg.includes('not found') ||
      msg.includes('arrow error') ||
      msg.includes('invalid input')
    );
  }

  /** Delete the entire .lancedb/ directory and reset state. */
  private async nukeAndReset(): Promise<void> {
    this.db = null;
    this.table = null;
    this.hasFtsIndex = false;

    try {
      await fs.promises.rm(this.dbPath, { recursive: true, force: true });
    } catch (err) {
      // OS-level file locks may prevent deletion — warn but don't crash
      const detail = err instanceof Error ? err.message : String(err);
      this.onWarn(`[Totem] Could not delete index at ${this.dbPath}: ${detail}`);
    }

    // Reconnect to create a fresh empty database
    this.db = await lancedb.connect(this.dbPath);
  }

  /** Insert chunks into the store. Embeds them first. */
  async insert(chunks: Chunk[]): Promise<void> {
    if (chunks.length === 0) return;

    // Build the text to embed: contextPrefix + content
    const textsToEmbed = chunks.map((c) => `${c.contextPrefix} ${c.content}`);

    const vectors = await this.embedder.embed(textsToEmbed);

    const rows: StoredChunk[] = chunks.map((chunk, i) => ({
      id: randomUUID(),
      content: chunk.content,
      contextPrefix: chunk.contextPrefix,
      filePath: chunk.filePath,
      type: chunk.type,
      strategy: chunk.strategy,
      label: chunk.label,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      metadata: JSON.stringify(chunk.metadata),
      vector: vectors[i]!,
    }));

    const data = rows as unknown as Record<string, unknown>[];

    if (!this.table) {
      this.table = await this.db!.createTable(TOTEM_TABLE_NAME, data);
    } else {
      await this.table.add(data);
    }
  }

  /**
   * Create (or rebuild) the FTS index on the `content` column.
   * Must be called after table creation or after incremental adds,
   * because LanceDB FTS indexes do not auto-update on `table.add()`.
   * Uses `replace: true` (the LanceDB default) to overwrite any stale index.
   */
  async createFtsIndex(): Promise<void> {
    if (!this.table) return;

    try {
      await this.table.createIndex('content', {
        config: lancedb.Index.fts(),
        replace: true,
      });
      this.hasFtsIndex = true;
    } catch (err) {
      // Non-fatal: hybrid search degrades to vector-only
      const msg = err instanceof Error ? err.message : String(err);
      this.onWarn(`FTS index creation failed: ${msg}`);
      this.hasFtsIndex = false;
    }
  }

  /** Check whether an FTS index exists on the table. */
  private async detectFtsIndex(): Promise<void> {
    if (!this.table) {
      this.hasFtsIndex = false;
      return;
    }
    try {
      const indices = await this.table.listIndices();
      this.hasFtsIndex = indices.some(
        (idx) => idx.indexType === 'FTS' || idx.name === 'content_idx',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.onWarn(`FTS index detection failed: ${msg}`);
      this.hasFtsIndex = false;
    }
  }

  /** Whether the FTS index is available for hybrid search. */
  get ftsIndexReady(): boolean {
    return this.hasFtsIndex;
  }

  /**
   * Search with optional hybrid mode (vector + FTS with RRF reranking).
   * Falls back to vector-only if no FTS index exists.
   */
  async search(options: SearchOptions): Promise<SearchResult[]> {
    if (!this.table) return [];

    const maxResults = options.maxResults ?? 5;
    const boundary = options.boundary;
    const useHybrid = (options.hybrid ?? true) && this.hasFtsIndex;

    if (useHybrid) {
      return this.hybridSearch(options.query, options.typeFilter, maxResults, boundary);
    }

    return this.vectorSearch(options.query, options.typeFilter, maxResults, boundary);
  }

  /** Pure vector search (original behavior). */
  private async vectorSearch(
    query: string,
    typeFilter: ContentType | undefined,
    maxResults: number,
    boundary?: string,
  ): Promise<SearchResult[]> {
    const [queryVector] = await this.embedder.embed([query]);

    let q = this.table!.vectorSearch(queryVector!).limit(maxResults);

    const whereClause = buildWhereClause(typeFilter, boundary);
    if (whereClause) q = q.where(whereClause);

    const results = await q.toArray();
    return results.map(rowToSearchResult);
  }

  /**
   * Hybrid search: runs vector + FTS in parallel, merges with RRF.
   * Each leg fetches `maxResults * HYBRID_OVERFETCH_FACTOR` candidates
   * to give RRF enough diversity to produce `maxResults` fused results.
   */
  private async hybridSearch(
    query: string,
    typeFilter: ContentType | undefined,
    maxResults: number,
    boundary?: string,
  ): Promise<SearchResult[]> {
    const fetchCount = maxResults * HYBRID_OVERFETCH_FACTOR;
    const whereClause = buildWhereClause(typeFilter, boundary);

    const [queryVector] = await this.embedder.embed([query]);

    // Run both legs in parallel
    const [vectorResults, ftsResults] = await Promise.all([
      this.runVectorLeg(queryVector!, whereClause, fetchCount),
      this.runFtsLeg(query, whereClause, fetchCount),
    ]);

    // Merge with RRF
    return rrfMerge(vectorResults, ftsResults, maxResults);
  }

  private async runVectorLeg(
    queryVector: number[],
    whereClause: string | undefined,
    limit: number,
  ): Promise<RankedRow[]> {
    let q = this.table!.vectorSearch(queryVector).limit(limit).withRowId();
    if (whereClause) q = q.where(whereClause);

    const rows = await q.toArray();
    return rows.map((row, rank) => ({
      row,
      rank: rank + 1,
      id: String(row['_rowid'] ?? row['id']),
    }));
  }

  private async runFtsLeg(
    query: string,
    whereClause: string | undefined,
    limit: number,
  ): Promise<RankedRow[]> {
    try {
      let q = this.table!.search(query, 'fts', 'content').withRowId();

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
      this.onWarn(`FTS search failed, falling back to vector-only: ${msg}`);
      return [];
    }
  }

  /** Delete all chunks from a specific file (for incremental re-index). */
  async deleteByFile(filePath: string): Promise<void> {
    if (!this.table) return;
    await this.table.delete(`\`filePath\` = '${filePath.replace(/'/g, "''")}'`);
  }

  /** Drop the entire table. Used for full re-index. */
  async reset(): Promise<void> {
    if (!this.db) return;

    const tableNames = await this.db.tableNames();
    if (tableNames.includes(TOTEM_TABLE_NAME)) {
      await this.db.dropTable(TOTEM_TABLE_NAME);
    }
    this.table = null;
    this.hasFtsIndex = false;
  }

  /** Re-open the LanceDB connection, picking up rebuilt files after a full sync. */
  async reconnect(): Promise<void> {
    this.db = null;
    this.table = null;
    this.hasFtsIndex = false;
    await this.connect();
  }

  /** Return true if the table doesn't exist or has zero rows. */
  async isEmpty(): Promise<boolean> {
    if (!this.table) return true;
    return (await this.table.countRows()) === 0;
  }

  /** Return stats about the current index. */
  async stats(): Promise<{ totalChunks: number; byType: Record<string, number> }> {
    if (!this.table) return { totalChunks: 0, byType: {} };

    const totalChunks = await this.table.countRows();

    const typeRows = await this.table.query().select(['type']).toArray();
    const byType: Record<string, number> = {};
    for (const row of typeRows) {
      const t = row['type'] as string;
      byType[t] = (byType[t] ?? 0) + 1;
    }

    return { totalChunks, byType };
  }

  /** Run a health check against the index, verifying dimensions, search, and FTS. */
  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    const issues: string[] = [];

    let totalChunks = 0;
    let storedDimensions: number | null = null;
    let dimensionMatch = false;
    let canarySearchOk = false;
    let ftsAvailable = false;
    const expectedDimensions = this.embedder.dimensions;

    // 1. Count rows and check dimensions
    try {
      if (this.table) {
        totalChunks = await this.table.countRows();

        if (totalChunks > 0) {
          // Read one row to get stored vector dimensions
          const rows = await this.table.query().select(['vector']).limit(1).toArray();
          if (rows.length > 0) {
            const raw = rows[0]!['vector'];
            // LanceDB may return Arrow FixedSizeList — coerce to plain array
            const vec = Array.isArray(raw)
              ? raw
              : raw && typeof (raw as { toArray?: () => number[] }).toArray === 'function'
                ? (raw as { toArray: () => number[] }).toArray()
                : raw && typeof (raw as { length?: number }).length === 'number'
                  ? Array.from(raw as ArrayLike<number>)
                  : null;
            if (vec) {
              storedDimensions = vec.length;
              dimensionMatch = storedDimensions === expectedDimensions;
              if (!dimensionMatch) {
                issues.push(
                  `Dimension mismatch: embedder expects ${expectedDimensions} but stored vectors have ${storedDimensions}`,
                );
              }
            } else {
              issues.push('Could not read vector column from stored row');
            }
          }
        } else {
          // Empty table — dimensions can't be verified but that's OK
          dimensionMatch = true;
        }
      } else {
        // No table — treat as empty, still healthy
        dimensionMatch = true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      issues.push(`Dimension check failed: ${msg}`);
    }

    // 2. Canary search — embed a probe string and run a search
    try {
      if (this.table && totalChunks > 0) {
        await this.search({ query: 'totem health check canary', maxResults: 1, hybrid: false });
        canarySearchOk = true;
      } else {
        // No data to search — canary is trivially OK
        canarySearchOk = true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      issues.push(`Canary search failed: ${msg}`);
    }

    // 3. FTS availability
    try {
      await this.detectFtsIndex();
      ftsAvailable = this.hasFtsIndex;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      issues.push(`FTS detection failed: ${msg}`);
    }

    const durationMs = Date.now() - start;
    const healthy = issues.length === 0;

    return {
      healthy,
      durationMs,
      totalChunks,
      expectedDimensions,
      storedDimensions,
      dimensionMatch,
      canarySearchOk,
      ftsAvailable,
      issues,
    };
  }
}

// ─── Internal helpers ──────────────────────────────────

interface RankedRow {
  row: Record<string, unknown>;
  rank: number;
  id: string;
}

/** Build a SQL WHERE clause from optional type and boundary filters. */
function buildWhereClause(typeFilter?: ContentType, boundary?: string): string | undefined {
  const conditions: string[] = [];
  if (typeFilter) {
    conditions.push(`\`type\` = '${typeFilter.replace(/'/g, "''")}'`);
  }
  if (boundary && boundary.length > 0) {
    // Normalize Windows backslashes to forward slashes
    const normalized = boundary.replace(/\\/g, '/');
    // Escape SQL LIKE wildcards (%, _, \) to ensure strict prefix matching
    const escaped = normalized
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_')
      .replace(/'/g, "''");
    conditions.push(`\`filePath\` LIKE '${escaped}%'`);
  }
  return conditions.length > 0 ? conditions.join(' AND ') : undefined;
}

/** Convert a raw LanceDB row to a SearchResult. */
function rowToSearchResult(row: Record<string, unknown>): SearchResult {
  return {
    content: row['content'] as string,
    contextPrefix: row['contextPrefix'] as string,
    filePath: row['filePath'] as string,
    type: row['type'] as ContentType,
    label: row['label'] as string,
    score: row['_distance'] != null ? 1 / (1 + (row['_distance'] as number)) : 0,
    metadata: JSON.parse((row['metadata'] as string) || '{}') as Record<string, string>,
  };
}

/**
 * Reciprocal Rank Fusion — merges two ranked result lists.
 * score(d) = Σ 1 / (k + rank_in_list) for each list containing d.
 */
function rrfMerge(listA: RankedRow[], listB: RankedRow[], limit: number): SearchResult[] {
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
    .map(({ score, row }) => ({ ...rowToSearchResult(row), score }));
}
