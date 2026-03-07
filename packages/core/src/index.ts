// Config schemas
export type {
  ChunkStrategy,
  ConfigTier,
  ContentType,
  EmbeddingProvider,
  IngestTarget,
  Orchestrator,
  TotemConfig,
} from './config-schema.js';
export {
  ChunkStrategySchema,
  ConfigTierSchema,
  ContentTypeSchema,
  DEFAULT_IGNORE_PATTERNS,
  EmbeddingProviderSchema,
  getConfigTier,
  IngestTargetSchema,
  requireEmbedding,
  OllamaProviderSchema,
  OpenAIProviderSchema,
  OrchestratorSchema,
  ShellOrchestratorSchema,
  TotemConfigSchema,
} from './config-schema.js';

// Types
export type {
  Chunk,
  SearchOptions,
  SearchResult,
  StoredChunk,
  SyncOptions,
  SyncState,
} from './types.js';

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
export { getChangedFiles, getHeadSha, resolveFiles, runSync } from './ingest/sync.js';

// Utilities
export { wrapXml } from './xml-format.js';
