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
import { runHealthCheck } from './lance-health.js';
import { TOTEM_TABLE_NAME } from './lance-schema.js';
import { runFtsSearch, runHybridSearch, runVectorSearch } from './lance-search.js';

/**
 * Escape a string for use in a LanceDB SQL WHERE clause (single-quoted literal).
 *
 * LanceDB uses DataFusion under the hood, which follows the SQL standard:
 * single quotes are escaped by doubling ('' → ') and backslash is treated
 * as a literal character (NOT an escape character). Therefore only quote
 * doubling is required — escaping backslashes would break path matching.
 */
export function escapeSqlString(input: string): string {
  return input.replace(/'/g, "''");
}

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

  /**
   * Connect for FTS-only use — skips embedder dimension validation.
   * Use when the embedder is unavailable (offline, no API key) and
   * only FTS search will be performed.
   */
  async connectFtsOnly(): Promise<void> {
    try {
      this.db = await lancedb.connect(this.dbPath);

      const tableNames = await this.db.tableNames();
      if (tableNames.includes(TOTEM_TABLE_NAME)) {
        this.table = await this.db.openTable(TOTEM_TABLE_NAME);
        await this.detectFtsIndex();
      }
    } catch (err) {
      // Read-only fallback — never nuke the index. Just warn and leave store empty.
      const msg = err instanceof Error ? err.message : String(err);
      this.onWarn(`[Totem] FTS-only connect failed: ${msg}`);
      this.db = null;
      this.table = null;
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
      return runHybridSearch(
        this.table,
        this.embedder,
        this.onWarn,
        options.query,
        options.typeFilter as ContentType | undefined,
        maxResults,
        boundary,
      );
    }

    return runVectorSearch(
      this.table,
      this.embedder,
      options.query,
      options.typeFilter as ContentType | undefined,
      maxResults,
      boundary,
    );
  }

  /**
   * FTS-only search — no embedder required.
   * Use when embedding is unavailable (offline, no API key, cold-start fallback).
   * Requires an FTS index to exist; returns empty if none available.
   */
  async searchFts(options: SearchOptions): Promise<SearchResult[]> {
    if (!this.table || !this.hasFtsIndex) return [];

    return runFtsSearch(
      this.table,
      this.onWarn,
      options.query,
      options.typeFilter as ContentType | undefined,
      options.maxResults ?? 5,
      options.boundary,
    );
  }

  /** Delete all chunks from a specific file (for incremental re-index). */
  async deleteByFile(filePath: string): Promise<void> {
    if (!this.table) return;
    const safePath = escapeSqlString(filePath);
    await this.table.delete(`\`filePath\` = '${safePath}'`);
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

  /** Return the total number of rows in the store. */
  async count(): Promise<number> {
    if (!this.table) return 0;
    return this.table.countRows();
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
    return runHealthCheck(
      this.table,
      this.embedder,
      (options) => this.search(options),
      () => this.detectFtsIndex(),
      () => this.hasFtsIndex,
    );
  }
}
