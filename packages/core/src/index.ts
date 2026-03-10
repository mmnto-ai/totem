// Config schemas
export type {
  ChunkStrategy,
  ConfigTier,
  ContentType,
  DocTarget,
  EmbeddingProvider,
  IngestTarget,
  Orchestrator,
  TotemConfig,
} from './config-schema.js';
export {
  AnthropicOrchestratorSchema,
  ChunkStrategySchema,
  ConfigTierSchema,
  ContentTypeSchema,
  DEFAULT_IGNORE_PATTERNS,
  DocTargetSchema,
  EmbeddingProviderSchema,
  GeminiOrchestratorSchema,
  getConfigTier,
  IngestTargetSchema,
  OllamaProviderSchema,
  OpenAIProviderSchema,
  OrchestratorSchema,
  requireEmbedding,
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

// Drift detection
export type { DriftResult, ParsedLesson } from './drift-detector.js';
export {
  detectDrift,
  extractFileReferences,
  parseLessonsFile,
  rewriteLessonsFile,
} from './drift-detector.js';

// Compiler
export type {
  AstContext,
  CompiledRule,
  CompiledRulesFile,
  CompilerOutput,
  DiffAddition,
  Violation,
} from './compiler.js';
export {
  applyRules,
  applyRulesToAdditions,
  CompiledRuleSchema,
  CompiledRulesFileSchema,
  CompilerOutputSchema,
  extractAddedLines,
  hashLesson,
  loadCompiledRules,
  parseCompilerResponse,
  type RegexValidation,
  saveCompiledRules,
  validateRegex,
} from './compiler.js';

// AST classification
export type { SupportedLanguage } from './ast-classifier.js';
export { classifyLines, extensionToLanguage } from './ast-classifier.js';
export { enrichWithAstContext } from './ast-gate.js';
export type { AstGateOptions } from './ast-gate.js';

// Exporter
export {
  exportLessons,
  formatLessonsAsMarkdown,
  injectSentinelBlock,
  SENTINEL_END,
  SENTINEL_START,
} from './exporter.js';

// Utilities
export { generateLessonHeading, HEADING_MAX_CHARS, truncateHeading } from './lesson-format.js';
export { sanitize } from './sanitize.js';
export { wrapXml } from './xml-format.js';
