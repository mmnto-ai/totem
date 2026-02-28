import * as lancedb from '@lancedb/lancedb';
import { randomUUID } from 'node:crypto';
import type { Chunk, StoredChunk, SearchResult, SearchOptions } from '../types.js';
import type { ContentType } from '../config-schema.js';
import { TOTEM_TABLE_NAME } from './lance-schema.js';
import type { Embedder } from '../embedders/embedder.js';

export class LanceStore {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private dbPath: string;
  private embedder: Embedder;

  constructor(dbPath: string, embedder: Embedder) {
    this.dbPath = dbPath;
    this.embedder = embedder;
  }

  /** Connect to LanceDB. Must be called before any other operations. */
  async connect(): Promise<void> {
    this.db = await lancedb.connect(this.dbPath);

    const tableNames = await this.db.tableNames();
    if (tableNames.includes(TOTEM_TABLE_NAME)) {
      this.table = await this.db.openTable(TOTEM_TABLE_NAME);
    }
  }

  /** Insert chunks into the store. Embeds them first. */
  async insert(chunks: Chunk[]): Promise<void> {
    if (chunks.length === 0) return;

    // Build the text to embed: contextPrefix + content
    const textsToEmbed = chunks.map(
      (c) => `${c.contextPrefix} ${c.content}`,
    );

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

  /** Semantic vector search with optional type filtering. */
  async search(options: SearchOptions): Promise<SearchResult[]> {
    if (!this.table) return [];

    const maxResults = options.maxResults ?? 5;

    const [queryVector] = await this.embedder.embed([options.query]);

    let query = this.table
      .vectorSearch(queryVector!)
      .limit(maxResults);

    if (options.typeFilter) {
      query = query.where(`type = '${options.typeFilter.replace(/'/g, "''")}'`);
    }

    const results = await query.toArray();

    return results.map((row: Record<string, unknown>) => ({
      content: row['content'] as string,
      contextPrefix: row['contextPrefix'] as string,
      filePath: row['filePath'] as string,
      type: row['type'] as ContentType,
      label: row['label'] as string,
      score: row['_distance'] != null ? 1 / (1 + (row['_distance'] as number)) : 0,
      metadata: JSON.parse((row['metadata'] as string) || '{}') as Record<string, string>,
    }));
  }

  /** Delete all chunks from a specific file (for incremental re-index). */
  async deleteByFile(filePath: string): Promise<void> {
    if (!this.table) return;
    await this.table.delete(`filePath = '${filePath.replace(/'/g, "''")}'`);
  }

  /** Drop the entire table. Used for full re-index. */
  async reset(): Promise<void> {
    if (!this.db) return;

    const tableNames = await this.db.tableNames();
    if (tableNames.includes(TOTEM_TABLE_NAME)) {
      await this.db.dropTable(TOTEM_TABLE_NAME);
    }
    this.table = null;
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
}
