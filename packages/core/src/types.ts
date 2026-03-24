import { z } from 'zod';

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
 * Persisted state for incremental sync tracking.
 */
export interface SyncState {
  lastSyncSha: string;
  timestamp: number;
}

/**
 * Options for search queries.
 */
export interface SearchOptions {
  query: string;
  typeFilter?: ContentType;
  maxResults?: number;
  /** When true, combines vector + FTS results using RRF reranking. Requires an FTS index. */
  hybrid?: boolean;
  /** File path prefix(es) to restrict results to an architectural boundary. Accepts a single prefix or an array for multi-prefix partitions. */
  boundary?: string | string[];
}

/**
 * Result of a health check against the LanceDB index.
 */
export interface HealthCheckResult {
  healthy: boolean;
  durationMs: number;
  totalChunks: number;
  expectedDimensions: number;
  storedDimensions: number | null;
  dimensionMatch: boolean;
  canarySearchOk: boolean;
  ftsAvailable: boolean;
  issues: string[];
}

// ─── Lesson Frontmatter Schema (ADR-070) ──────────

export const LessonFrontmatterSchema = z.object({
  // Core Taxonomy
  type: z.literal('trap').default('trap'),
  category: z.enum(['security', 'architecture', 'performance', 'style']).optional(),
  severity: z.enum(['error', 'warning']).default('error'),

  // Unstructured Metadata (replaces flat **Tags:**)
  tags: z.array(z.string()).default([]),

  // Scope (replaces inline **Scope:**)
  scope: z
    .object({
      globs: z.array(z.string()).optional(),
    })
    .optional(),

  // Ecosystem Targeting
  ecosystem: z
    .object({
      frameworks: z.array(z.string()).optional(),
      version: z.string().optional(), // Semver matching — DEFERRED past 1.6.0
    })
    .optional(),

  // Governance
  lifecycle: z.enum(['nursery', 'stable', 'deprecated']).default('stable'),
  rpn: z.number().min(1).max(10).optional(), // Risk Priority Number (ADR-023) — DEFERRED

  // Pipeline 1 Explicit Compilation (replaces inline fields)
  compilation: z
    .object({
      engine: z.enum(['regex', 'ast', 'ast-grep']).optional(),
      pattern: z.union([z.string(), z.record(z.unknown())]).optional(),
    })
    .optional(),
});

export type LessonFrontmatter = z.infer<typeof LessonFrontmatterSchema>;
