import type { ChunkStrategy, ContentType } from './config-schema.js';

/**
 * A single chunk produced by any chunker.
 * This is the unit that gets embedded and stored.
 */
export interface Chunk {
  /** The text content to embed */
  content: string;

  /** Contextual prefix prepended before embedding */
  contextPrefix: string;

  /** Source file path (relative to project root) */
  filePath: string;

  /** Content type for metadata filtering */
  type: ContentType;

  /** Chunking strategy that produced this chunk */
  strategy: ChunkStrategy;

  /** Human-readable identifier (function name, heading path, etc.) */
  label: string;

  /** Start line in original file (1-indexed) */
  startLine: number;

  /** End line in original file (1-indexed) */
  endLine: number;

  /** Optional structured metadata (frontmatter fields, etc.) */
  metadata: Record<string, string>;
}

/**
 * A stored record in LanceDB — chunk + its embedding vector.
 */
export interface StoredChunk {
  id: string;
  content: string;
  contextPrefix: string;
  filePath: string;
  type: string;
  strategy: string;
  label: string;
  startLine: number;
  endLine: number;
  metadata: string; // JSON-stringified Record<string, string>
  vector: number[];
}

/**
 * Result returned from a search query.
 */
export interface SearchResult {
  content: string;
  contextPrefix: string;
  filePath: string;
  type: ContentType;
  label: string;
  score: number;
  metadata: Record<string, string>;
}

/**
 * Options for the sync operation.
 */
export interface SyncOptions {
  /** Project root directory (where totem.config.ts lives) */
  projectRoot: string;

  /** If true, only process files changed since last sync */
  incremental: boolean;

  /** If provided, only sync files matching these changed paths */
  changedFiles?: string[];

  /** Callback for progress reporting */
  onProgress?: (message: string) => void;
}

/**
 * Options for search queries.
 */
export interface SearchOptions {
  query: string;
  typeFilter?: ContentType;
  maxResults?: number;
}
