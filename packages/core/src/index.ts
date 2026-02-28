// Config schemas
export {
  TotemConfigSchema,
  ChunkStrategySchema,
  ContentTypeSchema,
  IngestTargetSchema,
  EmbeddingProviderSchema,
  OpenAIProviderSchema,
  OllamaProviderSchema,
} from './config-schema.js';

export type {
  TotemConfig,
  ChunkStrategy,
  ContentType,
  IngestTarget,
  EmbeddingProvider,
} from './config-schema.js';

// Types
export type {
  Chunk,
  StoredChunk,
  SearchResult,
  SyncOptions,
  SearchOptions,
} from './types.js';

// Chunkers
export { createChunker } from './chunkers/chunker.js';
export type { Chunker } from './chunkers/chunker.js';

// Embedders
export { createEmbedder } from './embedders/embedder.js';
export type { Embedder } from './embedders/embedder.js';

// Store
export { LanceStore } from './store/lance-store.js';
export { TOTEM_TABLE_NAME } from './store/lance-schema.js';

// Pipeline
export { runSync, resolveFiles, getChangedFiles } from './ingest/sync.js';
export type { ResolvedFile } from './ingest/sync.js';
