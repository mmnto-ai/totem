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
  GeminiProviderSchema,
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
  HealthCheckResult,
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

// Lesson I/O (directory-based)
export {
  lessonFileName,
  readAllLessons,
  writeLessonFile,
  writeLessonFileAsync,
} from './lesson-io.js';

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
  matchesGlob,
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
export type { AstGateOptions } from './ast-gate.js';
export { enrichWithAstContext } from './ast-gate.js';

// Exporter
export {
  exportLessons,
  formatLessonsAsMarkdown,
  injectSentinelBlock,
  SENTINEL_END,
  SENTINEL_START,
} from './exporter.js';

// SARIF output
export type { SarifLog, SarifOptions, SarifResult, SarifRun } from './sarif.js';
export { buildSarifLog, ruleId } from './sarif.js';

// Saga validator
export type { SagaViolation, ViolationType } from './saga-validator.js';
export { validateDocUpdate } from './saga-validator.js';

// Utilities
export {
  generateLessonHeading,
  HEADING_MAX_CHARS,
  rewriteLessonHeadings,
  truncateHeading,
} from './lesson-format.js';
export type { IngestionSanitizeOptions } from './sanitize.js';
export {
  BASE64_BLOB_RE,
  INSTRUCTIONAL_LEAKAGE_RE,
  sanitize,
  sanitizeForIngestion,
  UNICODE_ESCAPE_RE,
  XML_TAG_LEAKAGE_RE,
} from './sanitize.js';
export { wrapXml } from './xml-format.js';
