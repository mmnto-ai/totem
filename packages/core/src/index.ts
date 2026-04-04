// Unified findings model (ADR-071)
export type { FindingCategory, FindingSeverity, FindingSource, TotemFinding } from './finding.js';
export { findingToViolation, violationToFinding } from './finding.js';

// Error hierarchy
export type { TotemErrorCode } from './errors.js';
export {
  getErrorMessage,
  rethrowAsParseError,
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
  GarbageCollectionConfig,
  IngestTarget,
  Orchestrator,
  TotemConfig,
} from './config-schema.js';
export {
  AnthropicOrchestratorSchema,
  ChunkStrategySchema,
  CONFIG_FILES,
  ConfigTierSchema,
  ContentTypeSchema,
  DEFAULT_IGNORE_PATTERNS,
  DocTargetSchema,
  EmbeddingProviderSchema,
  GarbageCollectionSchema,
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

// Lesson Frontmatter (ADR-070)
export type { FrontmatterParseResult } from './lesson-frontmatter.js';
export { buildFrontmatterFromLegacy, extractFrontmatter } from './lesson-frontmatter.js';
export type { LessonFrontmatter } from './types.js';
export { LessonFrontmatterSchema } from './types.js';

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
export {
  getChangedFiles,
  getHeadSha,
  resolveFiles,
  runSync,
  verifyIndexMeta,
} from './ingest/sync.js';

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

// Retirement Ledger (#1165)
export type { RetiredLesson } from './retired-lessons.js';
export {
  isRetiredHeading,
  readRetiredLessons,
  RETIRED_LESSONS_FILE,
  retireLesson,
  writeRetiredLessons,
} from './retired-lessons.js';

// Compiler
export type {
  AstContext,
  CompiledRule,
  CompiledRulesFile,
  CompilerOutput,
  DiffAddition,
  RuleEventCallback,
  RuleEventContext,
  Violation,
} from './compiler.js';
export {
  applyAstRulesToAdditions,
  applyRules,
  applyRulesToAdditions,
  CompiledRuleSchema,
  CompiledRulesFileSchema,
  CompilerOutputSchema,
  type CoreLogger,
  engineFields,
  extractAddedLines,
  extractJustification,
  hashLesson,
  loadCompiledRules,
  loadCompiledRulesFile,
  matchesGlob,
  parseCompilerResponse,
  type RegexValidation,
  sanitizeFileGlobs,
  saveCompiledRules,
  saveCompiledRulesFile,
  setCoreLogger,
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
  scaffoldFixture,
  scaffoldFixturePath,
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

// ast-grep query engine
export type { AstGrepMatch, AstGrepRule } from './ast-grep-query.js';
export { matchAstGrepPattern, matchAstGrepPatternsBatch } from './ast-grep-query.js';

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

// Project discovery
export type { ProjectDescription } from './describe.js';
export { describeProject } from './describe.js';

// Utilities
export {
  generateLessonHeading,
  HEADING_MAX_CHARS,
  rewriteLessonHeadings,
  truncateHeading,
} from './lesson-format.js';
export type { LessonLintDiagnostic, LessonLintResult } from './lesson-linter.js';
export { validateLessons } from './lesson-linter.js';
export type { BadGoodSnippets, ManualPattern, RuleExamples } from './lesson-pattern.js';
export {
  extractAllFields,
  extractBadGoodSnippets,
  extractField,
  extractManualPattern,
  extractRuleExamples,
  stripInlineCode,
} from './lesson-pattern.js';
export type { IngestionSanitizeOptions } from './sanitize.js';
export {
  BASE64_BLOB_RE,
  compileCustomSecrets,
  INSTRUCTIONAL_LEAKAGE_RE,
  isRegexSafe,
  maskSecrets,
  sanitize,
  sanitizeForIngestion,
  UNICODE_ESCAPE_RE,
  XML_TAG_LEAKAGE_RE,
} from './sanitize.js';
export { wrapUntrustedXml, wrapXml } from './xml-format.js';

// Suspicious lesson detection
export type { ExtractedLesson } from './suspicious-lesson.js';
export {
  collectCodeRanges,
  DEFENSIVE_KEYWORD_RE,
  DEFENSIVE_PROXIMITY_WINDOW,
  flagSuspiciousLessons,
  isInstructionalContext,
  MAX_SUSPICIOUS_HEADING_LENGTH,
} from './suspicious-lesson.js';

// Semantic deduplication
export { cosineSimilarity, deduplicateLessons } from './semantic-dedup.js';

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

// Compile lesson (rule builder + single-lesson compiler)
export type {
  BuildRuleResult,
  CompileLessonCallbacks,
  CompileLessonDeps,
  CompileLessonResult,
  LessonInput,
} from './compile-lesson.js';
export {
  buildCompiledRule,
  buildManualRule,
  compileLesson,
  deriveVirtualFilePath,
  formatExampleFailure,
  validateAstGrepPattern,
  verifyRuleExamples,
} from './compile-lesson.js';

// Compile manifest (signing / provenance)
export type { CompileManifest } from './compile-manifest.js';
export {
  CompileManifestSchema,
  generateInputHash,
  generateOutputHash,
  readCompileManifest,
  writeCompileManifest,
} from './compile-manifest.js';

// Global registry (multi-totem workspace discovery)
export type { RegistryEntry, TotemRegistry } from './registry.js';
export { readRegistry, updateRegistryEntry } from './registry.js';

// Secrets (user-defined DLP patterns)
export type { CustomSecret, SecretsFile } from './secrets.js';
export { CustomSecretSchema, loadCustomSecrets, SecretsFileSchema } from './secrets.js';

// Trap Ledger (suppression/override audit trail)
export type { LedgerEvent } from './ledger.js';
export { appendLedgerEvent, LedgerEventSchema, readLedgerEvents } from './ledger.js';

// Shell execution (cross-platform safe wrapper)
export type { SafeExecOptions } from './sys/exec.js';
export { safeExec } from './sys/exec.js';

// Git utilities (pure helpers — no CLI dependencies)
export {
  extractChangedFiles,
  filterDiffByPatterns,
  getDefaultBranch,
  getGitBranch,
  getGitBranchDiff,
  getGitDiff,
  getGitDiffStat,
  getGitLogSince,
  getGitStatus,
  getLatestTag,
  getTagDate,
  inferScopeFromFiles,
  isFileDirty,
  resolveGitRoot,
} from './sys/git.js';

// Filesystem helpers
export { readJsonSafe } from './sys/fs.js';

// Semgrep adapter (Pipeline 4 — import rules from Semgrep YAML)
export type { SemgrepImportResult } from './semgrep-adapter.js';
export { parseSemgrepRules } from './semgrep-adapter.js';

// ESLint adapter (Pipeline 4 — import rules from ESLint JSON config)
export type { EslintImportResult } from './eslint-adapter.js';
export { parseEslintConfig } from './eslint-adapter.js';

// Shared helper registry (prior art concierge for spec prompts)
export type { SharedHelper } from './sys/helpers.js';
export { formatSharedHelpers, getSharedHelpers } from './sys/helpers.js';

// Regex utilities (centralized escape + Pipeline 5 pattern builder)
export { codeToPattern, escapeRegex } from './regex-utils.js';

// Pipeline 5 — observation-based auto-capture from shield findings
export type { ObservationInput } from './pipeline-observation.js';
export { deduplicateObservations, generateObservationRule } from './pipeline-observation.js';
