// Config schemas
export type {
  ChunkStrategy,
  ContentType,
  EmbeddingProvider,
  IngestTarget,
  TotemConfig,
} from './config-schema.js';
export {
  ChunkStrategySchema,
  ContentTypeSchema,
  DEFAULT_IGNORE_PATTERNS,
  EmbeddingProviderSchema,
  IngestTargetSchema,
  OllamaProviderSchema,
  OpenAIProviderSchema,
  TotemConfigSchema,
} from './config-schema.js';

// Types
export type { Chunk, SearchOptions, SearchResult, StoredChunk, SyncOptions } from './types.js';

// Chunkers
export type { Chunker } from './chunkers/chunker.js';
export { createChunker } from './chunkers/chunker.js';

// Embedders
export type { Embedder } from './embedders/embedder.js';
export { createEmbedder } from './embedders/embedder.js';

// Store
export { TOTEM_TABLE_NAME } from './store/lance-schema.js';
export { LanceStore } from './store/lance-store.js';

// Pipeline
export type { ResolvedFile } from './ingest/sync.js';
export { getChangedFiles, resolveFiles, runSync } from './ingest/sync.js';
