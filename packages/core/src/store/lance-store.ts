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
  SourceContext,
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

/**
 * Stateless FTS-index probe. Shared by the instance-level `detectFtsIndex`
 * that maintains `this.hasFtsIndex` and by `openReadSnapshot()` which needs
 * to compute the flag for a fresh per-call table handle without touching
 * shared state (mmnto/totem#1418).
 */
async function detectFtsIndexOnTable(
  table: lancedb.Table | null,
  onWarn: (msg: string) => void,
): Promise<boolean> {
  if (!table) return false;
  try {
    const indices = await table.listIndices();
    return indices.some((idx) => idx.indexType === 'FTS' || idx.name === 'content_idx');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onWarn(`FTS index detection failed: ${msg}`);
    return false;
  }
}

/**
 * Close a per-query LanceDB connection opened by `openReadSnapshot()`.
 * `close()` can throw in some edge cases (e.g., the underlying directory
 * was removed mid-query). Swallow and warn so a failed close never masks
 * a successful search result (mmnto/totem#1418).
 */
function closeReadSnapshot(db: lancedb.Connection, onWarn: (msg: string) => void): void {
  try {
    if (db.isOpen()) {
      db.close();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onWarn(`LanceDB read-snapshot close failed: ${msg}`);
  }
}

export class LanceStore {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private dbPath: string;
  private embedder: Embedder;
  private hasFtsIndex = false;
  private onWarn: (msg: string) => void;
  /**
   * Instrumentation: number of times the read path has reopened the handle
   * via `refreshReadHandle()`. Exposed via `readRefreshCount` so tests
   * (mmnto/totem#1418) can assert the reopen fires on every search.
   */
  private readRefreshes = 0;
  /**
   * Source repo context injected at construction time. Primary stores use
   * `{ absolutePathRoot: projectRoot }` with no `sourceRepo`; linked stores
   * (mmnto/totem#1294 Cross-Repo Context Mesh) use
   * `{ sourceRepo: '<link name>', absolutePathRoot: '<linked repo root>' }`.
   * Passed down to every `search` / `searchFts` call so every SearchResult
   * gets stamped with the owning store's identity via `rowToSearchResult`.
   *
   * **Required** since mmnto/totem#1295 — CR flagged that an optional
   * context with a silent `filePath` fallback for `absoluteFilePath` sent
   * legacy callers down the wrong repo root instead of failing fast.
   * Making the parameter required closes that class of bug at the type
   * level and forces every call site to state its source explicitly.
   */
  private sourceContext: SourceContext;

  constructor(
    dbPath: string,
    embedder: Embedder,
    sourceContext: SourceContext,
    onWarn?: (msg: string) => void,
  ) {
    this.dbPath = dbPath;
    this.embedder = embedder;
    this.sourceContext = sourceContext;
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
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
      this.onWarn(`[Totem] FTS-only connect failed: ${detail}`);
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
    this.hasFtsIndex = await detectFtsIndexOnTable(this.table, this.onWarn);
  }

  /** Whether the FTS index is available for hybrid search. */
  get ftsIndexReady(): boolean {
    return this.hasFtsIndex;
  }

  /**
   * Search with optional hybrid mode (vector + FTS with RRF reranking).
   * Falls back to vector-only if no FTS index exists.
   *
   * Opens a fresh LanceDB snapshot for this call (mmnto/totem#1418) so an
   * external `totem sync` cannot leave this store reading a stale view,
   * and so concurrent searches never invalidate each other's handle.
   */
  async search(options: SearchOptions): Promise<SearchResult[]> {
    const snapshot = await this.openReadSnapshot();
    try {
      if (!snapshot.table) return [];

      const maxResults = options.maxResults ?? 5;
      const boundary = options.boundary;
      const useHybrid = (options.hybrid ?? true) && snapshot.hasFtsIndex;

      if (useHybrid) {
        return await runHybridSearch(
          snapshot.table,
          this.embedder,
          this.onWarn,
          options.query,
          options.typeFilter as ContentType | undefined,
          maxResults,
          this.sourceContext,
          boundary,
        );
      }

      return await runVectorSearch(
        snapshot.table,
        this.embedder,
        options.query,
        options.typeFilter as ContentType | undefined,
        maxResults,
        this.sourceContext,
        boundary,
      );
    } finally {
      closeReadSnapshot(snapshot.db, this.onWarn);
    }
  }

  /**
   * FTS-only search. No embedder required.
   * Use when embedding is unavailable (offline, no API key, cold-start fallback).
   * Requires an FTS index to exist; returns empty if none available.
   *
   * Opens a fresh LanceDB snapshot for this call (mmnto/totem#1418).
   */
  async searchFts(options: SearchOptions): Promise<SearchResult[]> {
    const snapshot = await this.openReadSnapshot();
    try {
      if (!snapshot.table || !snapshot.hasFtsIndex) return [];

      return await runFtsSearch(
        snapshot.table,
        this.onWarn,
        options.query,
        options.typeFilter as ContentType | undefined,
        options.maxResults ?? 5,
        this.sourceContext,
        options.boundary,
      );
    } finally {
      closeReadSnapshot(snapshot.db, this.onWarn);
    }
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

  /**
   * Open a fresh read snapshot (connection + table + fts flag) for a single
   * query. Scoped to the caller, NOT written onto `this.db` / `this.table`,
   * so concurrent searches don't race each other's handle lifetime
   * (mmnto/totem#1418 Shield CRITICAL follow-up).
   *
   * **Why unconditional reopen.** The MCP server holds LanceStore for the
   * life of the process. When `totem sync` (a separate process) rewrites
   * `.lancedb/` files underneath us, LanceDB's in-memory manifest keeps
   * pointing at the pre-sync snapshot. Vector search against that stale
   * view returns empty, which falls through to FTS-only via the hybrid
   * path, producing uniform ~0.016 RRF scores instead of real similarity
   * ranks. The corrupt path is silent because no exception fires.
   *
   * **Why not mtime-check.** A benchmark (see scripts/bench-lance-open.ts)
   * measured connect+openTable at ~0.5-1.1ms per call against real indexes.
   * That's well under the 10ms threshold where mtime gating starts to pay
   * for its own complexity. Reopening every time is strictly simpler and
   * eliminates a whole category of cache-invalidation bugs.
   *
   * **Why per-call snapshots.** Assigning the fresh connection to `this.db`
   * and then closing the old one from a second concurrent caller would
   * invalidate the first caller's in-flight query. Instead each call holds
   * its own connection + table references through the query lifetime, and
   * closes the connection in a finally block after the results return.
   * The instance-level `this.db` / `this.table` fields are still maintained
   * so write paths and existing consumers (healthCheck, stats, count) see
   * an up-to-date view on the next non-read call via `connect()`.
   *
   * **Why not also refresh write paths.** `totem sync` owns the writer
   * connection exclusively inside a single process. Write operations
   * (insert, deleteByFile, reset) already hold a consistent view for
   * their own workflow and a mid-sequence reopen would drop the in-flight
   * table reference that `insert()` sets during first-table creation.
   */
  private async openReadSnapshot(): Promise<{
    db: lancedb.Connection;
    table: lancedb.Table | null;
    hasFtsIndex: boolean;
  }> {
    const db = await lancedb.connect(this.dbPath);

    // Shield WARN guard: `tableNames()` and `openTable()` can both throw.
    // Without this try/catch the partially-opened `db` connection would
    // leak if either step failed, because the caller's finally block that
    // calls `closeReadSnapshot` only runs once the snapshot object is
    // returned. Close the connection inline before rethrowing so the
    // failure path is leak-free.
    try {
      const tableNames = await db.tableNames();

      let table: lancedb.Table | null = null;
      let hasFtsIndex = false;
      if (tableNames.includes(TOTEM_TABLE_NAME)) {
        table = await db.openTable(TOTEM_TABLE_NAME);
        hasFtsIndex = await detectFtsIndexOnTable(table, this.onWarn);
      }

      this.readRefreshes += 1;
      return { db, table, hasFtsIndex };
    } catch (err) {
      closeReadSnapshot(db, this.onWarn);
      throw err;
    }
  }

  /**
   * Test-seam instrumentation (mmnto/totem#1418): total count of read-path
   * handle refreshes since this store was constructed. Asserted by the
   * stale-handle regression test to confirm every search() call reopens.
   */
  get readRefreshCount(): number {
    return this.readRefreshes;
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
