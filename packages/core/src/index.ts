// Error hierarchy
export type { TotemErrorCode } from './errors.js';
export {
  TotemCompileError,
  TotemConfigError,
  TotemDatabaseError,
  TotemError,
  TotemGitError,
  TotemOrchestratorError,
  TotemParseError,
} from './errors.js';

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

// Concurrency lock
export { acquireLock, withLock } from './lock.js';

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
  RuleEventCallback,
  Violation,
} from './compiler.js';
export {
  applyAstRulesToAdditions,
  applyRules,
  applyRulesToAdditions,
  CompiledRuleSchema,
  CompiledRulesFileSchema,
  CompilerOutputSchema,
  extractAddedLines,
  hashLesson,
  loadCompiledRules,
  loadCompiledRulesFile,
  matchesGlob,
  parseCompilerResponse,
  type RegexValidation,
  saveCompiledRules,
  saveCompiledRulesFile,
  validateRegex,
} from './compiler.js';

// Rule testing
export {
  loadFixtures,
  parseFixture,
  type RuleTestFixture,
  type RuleTestResult,
  type RuleTestSummary,
  runRuleTests,
  testRule,
} from './rule-tester.js';

// AST classification
export type { SupportedLanguage } from './ast-classifier.js';
export { classifyLines, ensureInit, extensionToLanguage, loadGrammar } from './ast-classifier.js';
export type { AstGateOptions } from './ast-gate.js';
export { enrichWithAstContext } from './ast-gate.js';

// AST query engine
export type { AstMatch } from './ast-query.js';
export { matchAstQueriesBatch, matchAstQuery } from './ast-query.js';

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
export { buildSarifLog, DEFAULT_RULE_CATEGORY, ruleId } from './sarif.js';

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
  maskSecrets,
  sanitize,
  sanitizeForIngestion,
  UNICODE_ESCAPE_RE,
  XML_TAG_LEAKAGE_RE,
} from './sanitize.js';
export { wrapXml } from './xml-format.js';

// Cursor adapter (.mdc / .cursorrules ingestion)
export type { CursorInstruction } from './cursor-adapter.js';
export { scanCursorInstructions } from './cursor-adapter.js';

// Rule metrics (observability)
export type { RuleMetric, RuleMetricsFile } from './rule-metrics.js';
export {
  loadRuleMetrics,
  recordSuppression,
  recordTrigger,
  saveRuleMetrics,
} from './rule-metrics.js';
