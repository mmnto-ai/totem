// Unified findings model (ADR-071)
export type { FindingCategory, FindingSeverity, FindingSource, TotemFinding } from './finding.js';
export { findingToViolation, violationToFinding } from './finding.js';

// Badge verifier (mmnto-ai/totem#1926 — deterministic-tier mechanism)
export type {
  BadgeVerificationResult,
  ExtractedBadge,
  PathExistsPredicate,
  ToolIntegrationConfig,
} from './badge-verifier.js';
export {
  BadgeVerificationResultSchema,
  DEFAULT_TOOL_INTEGRATIONS,
  extractBadgesFromDiff,
  ToolIntegrationConfigSchema,
  verifySelfReferenceLinks,
  verifyToolClaims,
} from './badge-verifier.js';

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
export { buildMissingSdkHint } from './missing-sdk.js';

// Gate engine (WS3 — Proposal 288 §6.2)
export type {
  ActiveFreeze,
  CohortFreezeResult,
  CohortFreezeStatus,
  EffectiveFreezeResult,
  FreezeConfig,
  FreezeEntry,
  FreezeScope,
  LocalFreezeStatus,
} from './freeze.js';
export {
  FREEZE_FILE,
  FreezeScopeSchema,
  readCohortFreezes,
  readEffectiveFreezes,
  readFreezeConfig,
  RULE_COMPILATION_FREEZE_ID,
} from './freeze.js';
export { evaluateGate, FREEZE_CHECK_EVENT, knownGateEvents } from './gate-engine.js';
export type { GateDisposition, GateEvaluator, GateProvenance, GateVerdict } from './gate-types.js';

// Config schemas
export type {
  ChunkStrategy,
  ConfigTier,
  ContentType,
  DocTarget,
  DoctorConfig,
  EmbeddingProvider,
  GarbageCollectionConfig,
  IngestTarget,
  Orchestrator,
  OrientConfig,
  TotemConfig,
} from './config-schema.js';
export {
  AnthropicOrchestratorSchema,
  ChunkStrategySchema,
  CONFIG_FILES,
  ConfigTierSchema,
  ContentTypeSchema,
  DEFAULT_IGNORE_PATTERNS,
  DEFAULT_REVIEW_SOURCE_EXTENSIONS,
  DocTargetSchema,
  DoctorConfigSchema,
  EmbeddingProviderSchema,
  GarbageCollectionSchema,
  GeminiOrchestratorSchema,
  GeminiProviderSchema,
  getConfigTier,
  IngestTargetSchema,
  OllamaProviderSchema,
  OpenAIProviderSchema,
  OrchestratorSchema,
  OrientConfigSchema,
  requireEmbedding,
  ReviewConfigSchema,
  ReviewSourceExtensionSchema,
  ShellOrchestratorSchema,
  TotemConfigSchema,
} from './config-schema.js';

// Lesson Frontmatter (ADR-070)
export type { FrontmatterParseResult } from './lesson-frontmatter.js';
export { buildFrontmatterFromLegacy, extractFrontmatter } from './lesson-frontmatter.js';
export type { LessonFrontmatter, LessonRole } from './types.js';
export { LessonFrontmatterSchema, LessonRoleSchema } from './types.js';

// Lesson role-applicability filter (strategy item 020)
export type { LessonWithAppliesTo } from './lesson-role-filter.js';
export { filterLessonsByRole } from './lesson-role-filter.js';

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
export {
  isBuiltin as isBuiltinChunkStrategy,
  registeredNames as registeredChunkStrategies,
} from './chunkers/chunker-registry.js';

// ast-grep language registry public surface (mmnto-ai/totem#1653 + #1768,
// ADR-097 § 10). The base AST classification exports — `SupportedLanguage`,
// `extensionToLanguage`, `loadGrammar` — are re-exported below in the
// "AST classification" section to preserve historical ordering.
export { isBuiltinExtension, registeredExtensions, registeredLanguages } from './ast-classifier.js';

// Pack discovery substrate (mmnto-ai/totem#1768, ADR-097 § 10)
export type {
  InstalledPacksManifest,
  LoadedPack,
  LoadInstalledPacksOptions,
  PackRegisterCallback,
  PackRegistrationAPI,
} from './pack-discovery.js';
export {
  InstalledPacksManifestSchema,
  isEngineSealed,
  loadedPacks,
  loadInstalledPacks,
  resolveEngineVersion,
} from './pack-discovery.js';

// Pack manifest writer (mmnto-ai/totem#1768, Step 4)
export type {
  PackResolutionResult,
  PackResolutionWarning,
  ResolveInstalledPacksInput,
} from './pack-manifest-writer.js';
export { resolveInstalledPacks, writeInstalledPacksManifest } from './pack-manifest-writer.js';

// Stale-manifest detector (mmnto-ai/totem#1811, ADR-101)
export type {
  DetectStaleManifestOptions,
  StaleManifestDetection,
  StaleManifestReason,
} from './stale-manifest.js';
export { detectStaleManifest, staleManifestError } from './stale-manifest.js';

// Embedders
export type { Embedder } from './embedders/embedder.js';
export { createEmbedder, isOllamaAvailable } from './embedders/embedder.js';

// Store
export { TOTEM_TABLE_NAME } from './store/lance-schema.js';
export { LanceStore } from './store/lance-store.js';

// Pipeline
export type { IndexManifest, ManifestDocument, ResolvedFile } from './ingest/sync.js';
export {
  buildIndexManifest,
  getChangedFiles,
  getHeadSha,
  INDEX_MANIFEST_SCHEMA,
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
  AstGrepYamlRule,
  CompiledRule,
  CompiledRulesFile,
  CompilerOutput,
  DiffAddition,
  Legitimacy,
  NapiConfig,
  NonCompilableEntry,
  NonCompilableReasonCode,
  ProvenanceRecord,
  RuleEventCallback,
  RuleEventContext,
  Violation,
} from './compiler.js';
export {
  applyAstRulesToAdditions,
  applyRules,
  applyRulesToAdditions,
  AstGrepYamlRuleSchema,
  CompiledRuleSchema,
  CompiledRulesFileSchema,
  CompilerOutputSchema,
  type CoreLogger,
  deriveRuleClass,
  engineFields,
  extractAddedLines,
  extractJustification,
  fileMatchesGlobs,
  hashLesson,
  LEDGER_RETRY_PENDING_CODES,
  LegitimacySchema,
  loadCompiledRules,
  loadCompiledRulesFile,
  matchesGlob,
  NapiConfigSchema,
  NonCompilableEntryReadSchema,
  NonCompilableEntryWriteSchema,
  NonCompilableReasonCodeSchema,
  parseCompilerResponse,
  ProvenanceRecordSchema,
  type RegexValidation,
  type RuleEngineContext,
  sanitizeFileGlobs,
  saveCompiledRules,
  saveCompiledRulesFile,
  shouldWriteToLedger,
  validateRegex,
} from './compiler.js';

// Bounded regex evaluation (mmnto-ai/totem#1641)
export {
  applyRulesToAdditionsBounded,
  type BoundedApplyOptions,
  type BoundedApplyResult,
  type RuleTimeoutOutcome,
  type TimeoutMode,
} from './regex-safety/apply-rules-bounded.js';
export {
  type EvaluateInput,
  type EvaluateResult,
  RegexEvaluator,
  type RegexEvaluatorConfig,
} from './regex-safety/evaluator.js';
export { redactPath, type RegexTelemetry, RegexTelemetrySchema } from './regex-safety/telemetry.js';

// Rule testing
export {
  FIXTURE_CORPORA,
  FIXTURE_SURFACES,
  type FixtureCorpus,
  type FixtureSurface,
  isTodoFixture,
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
  parseDeclaredSeverity,
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
export {
  cosineSimilarity,
  deduplicateByHeading,
  deduplicateLessons,
  normalizeHeading,
} from './semantic-dedup.js';

// Cursor adapter (.mdc / .cursorrules ingestion)
export type { CursorInstruction } from './cursor-adapter.js';
export { scanCursorInstructions } from './cursor-adapter.js';

// Rule metrics (observability)
export type { ContextCounts, RuleMetric, RuleMetricsFile } from './rule-metrics.js';
export {
  loadRuleMetrics,
  recordContextHit,
  recordEvaluation,
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
  LayerTraceEvent,
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

// Stage 4 Verify-Against-Codebase verifier (mmnto-ai/totem#1682)
export type {
  ResolveStage4BaselineInput,
  Stage4Baseline,
  Stage4Outcome,
  Stage4VerificationResult,
  Stage4VerifierDeps,
} from './stage4-verifier.js';
export {
  DEFAULT_BASELINE_GLOBS,
  getDefaultBaseline,
  parseStage4BaselineDirectives,
  resolveStage4Baseline,
  STAGE4_MANIFEST_EXCLUSIONS,
  verifyAgainstCodebase,
} from './stage4-verifier.js';

// Pack pending-verification install→lint promotion (mmnto-ai/totem#1684)
export type { PromotePendingRulesDeps, PromotePendingRulesResult } from './first-lint-promote.js';
export { applyOutcomeToRule, promotePendingRules } from './first-lint-promote.js';
export type {
  Stage4OutcomeStoredValue,
  VerificationOutcomeEntry,
  VerificationOutcomesFile,
  VerificationOutcomesStore,
} from './verification-outcomes.js';
export {
  readVerificationOutcomes,
  Stage4OutcomeStored,
  VerificationOutcomeEntrySchema,
  VerificationOutcomesFileSchema,
  writeVerificationOutcomes,
} from './verification-outcomes.js';

// Compile manifest (signing / provenance)
export type { CompileManifest } from './compile-manifest.js';
export {
  canonicalizeKeys,
  canonicalStringify,
  CompileManifestSchema,
  generateInputHash,
  generateOutputHash,
  readCompileManifest,
  writeCompileManifest,
} from './compile-manifest.js';

// Compile-worker fingerprint (producer attestation — Proposal 278 § Action 3)
export type { CompileWorkerFingerprintInputs } from './compile-worker-fingerprint.js';
export {
  computeCompileWorkerFingerprint,
  modelStripsTemperature,
  readPromptTemplateContentHash,
} from './compile-worker-fingerprint.js';

// Compile cache (Proposal 281 — Per-Lesson Hash Stability)
export type { CacheDecision, CacheEntry } from './compile-cache.js';
export {
  buildCacheEntry,
  cacheEntryPath,
  CacheEntrySchema,
  composeLessonSourceForHash,
  computeLessonSourceHash,
  listCacheEntries,
  lookupCacheEntry,
  migrateFromCompiledRules,
  writeCacheEntry,
} from './compile-cache.js';

// Global registry (multi-totem workspace discovery)
export type { RegistryEntry, TotemRegistry } from './registry.js';
export { readRegistry, updateRegistryEntry } from './registry.js';

// Secrets (user-defined DLP patterns)
export type { CustomSecret, SecretsFile } from './secrets.js';
export { CustomSecretSchema, loadCustomSecrets, SecretsFileSchema } from './secrets.js';

// Trap Ledger (suppression/override audit trail)
export type { LedgerEvent } from './ledger.js';
export { appendLedgerEvent, LedgerEventSchema, readLedgerEvents } from './ledger.js';

// Session ID — A.3.a SessionStart hook + MCP correlation
export { mintSessionId, readSessionId, writeSessionId } from './session-id.js';

// Pack rule merge primitive (ADR-085 + ADR-089, mmnto-ai/totem#1485)
export type { ImmutableOverrideBlock, MergeRulesResult } from './pack-merge.js';
export { mergeRules } from './pack-merge.js';

// Shell execution (cross-platform safe wrapper)
export type { SafeExecOptions } from './sys/exec.js';
export { describeSafeExecError, safeExec } from './sys/exec.js';

// Git-Bash resolution (mmnto-ai/totem#2159 — bare `bash` is never spawned by repo tooling on win32)
export {
  _clearBashResolverCacheForTesting,
  bashSpawnEnv,
  resolveBash,
} from './sys/bash-resolver.js';

// Git utilities (pure helpers — no CLI dependencies)
export {
  extractChangedFiles,
  filterDiffByPatterns,
  findRepoRootSync,
  getDefaultBranch,
  getGitBranch,
  getGitBranchDiff,
  getGitDiff,
  getGitDiffRange,
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

// Grounded run artifacts (mmnto-ai/totem#2100 slice 1, mmnto-ai/totem#2101 slice 2, mmnto-ai/totem#2102 slice 3)
export type { GroundingSourceItem } from './artifacts/grounding.js';
export { buildGroundingBundle, summarizeProvenance } from './artifacts/grounding.js';
export { calculateDeterministicHash } from './artifacts/hash.js';
export type {
  BackendAdmissionClass,
  ContextPolicy,
  GroundingBundle,
  GroundingItem,
  InputBundle,
  OutputContract,
  RunArtifact,
  RunMetadata,
} from './artifacts/schema.js';
export {
  ADMISSION_CLASSES,
  ADMISSION_COMPLETION_ONLY,
  ADMISSION_SELF_GROUNDING_AGENT,
  ContextPolicySchema,
  GroundingBundleSchema,
  GroundingItemSchema,
  OutputContractSchema,
  PROVENANCE_CLASSES,
  PROVENANCE_COMPILED_RULE,
  PROVENANCE_SIMILARITY_ONLY,
  PROVENANCE_SPEC_CONTRACT,
  PROVENANCE_STRUCTURALLY_VERIFIED,
  PROVENANCE_UNGROUNDED,
  RUN_ARTIFACT_SCHEMA_VERSION,
  RunArtifactSchema,
  RunMetadataSchema,
} from './artifacts/schema.js';
// Deterministic structural post-checks (mmnto-ai/totem#2103 slice 4)
export type {
  CheckResult,
  CheckVerdict,
  EnforcementTier,
  OverrideSet,
  PostCheckContext,
  PostCheckFinding,
  PostCheckReport,
  PostCheckRule,
} from './artifacts/post-checks.js';
export { evaluatePostChecks, resolveCaller } from './artifacts/post-checks.js';
export type { Citation } from './artifacts/post-checks-rules.js';
export {
  citationResolvesRule,
  DEFAULT_RULES,
  extractCitations,
  isContained,
  lineRefValid,
  overrideReappearanceRule,
  provenanceSensorRule,
  specVerifyRule,
  structuredOutputRule,
} from './artifacts/post-checks-rules.js';
export type { SaveRunArtifactResult } from './artifacts/storage.js';
export {
  computeRunArtifactContentHash,
  loadRunArtifact,
  runsDir,
  saveRunArtifact,
} from './artifacts/storage.js';
// Panel synthesis — independent lanes, script aggregation (mmnto-ai/totem#2104 slice 5)
export type {
  PanelArtifact,
  PanelDiversity,
  PanelDiversityClass,
  PanelLane,
  PanelLaneInput,
  PanelSynthesis,
  PersistedPostCheckFinding,
  PersistedPostCheckReport,
  SavePanelArtifactResult,
  SynthesisFinding,
} from './artifacts/panel.js';
export {
  assemblePanelArtifact,
  classifyDiversity,
  computePanelArtifactContentHash,
  PANEL_ARTIFACT_KNOWN_MAJOR,
  PANEL_ARTIFACT_SCHEMA_VERSION,
  PanelArtifactSchema,
  PanelDiversityClassSchema,
  PanelDiversitySchema,
  PanelLaneSchema,
  panelsDir,
  PanelSynthesisSchema,
  PersistedPostCheckFindingSchema,
  PersistedPostCheckReportSchema,
  readPanelArtifact,
  SynthesisFindingSchema,
  synthesizePanel,
  writePanelArtifact,
} from './artifacts/panel.js';

// Strategy-root resolver (mmnto-ai/totem#1710)
export type {
  StrategyResolverConfig,
  StrategyResolverOptions,
  StrategyRootStatus,
} from './strategy-resolver.js';
export { resolveStrategyRoot } from './strategy-resolver.js';

// Substrate-path resolver (mmnto-ai/totem#1820, ADR-100 Phase C)
export type {
  SubstratePaths,
  SubstrateResolverConfig,
  SubstrateResolverOptions,
} from './substrate-resolver.js';
export { resolveSubstratePaths } from './substrate-resolver.js';

// Orchestration-path resolver (mmnto-ai/totem-strategy#341, ADR-106 — Proposal 282)
// Additive sibling to resolveSubstratePaths; substrate stays live as the
// frozen-archive read path while orchestration is the active read+write surface.
export type { OrchestrationPaths, SelfAgentResolution } from './orchestration-resolver.js';
export {
  isPathSafeAgentId,
  knownCohortAgents,
  resolveOrchestrationPaths,
  resolveSelfAgents,
} from './orchestration-resolver.js';

// Parity-manifest parser + config-path resolver (mmnto-ai/totem-strategy#448)
export type {
  ParityContract,
  ParityManifest,
  ParityManifestation,
  ParityManifestLoadResult,
  ParityManifestParseResult,
  ParityManifestPathStatus,
  ParitySense,
  ParityTractability,
} from './parity-manifest.js';
export {
  loadParityManifest,
  PARITY_MANIFESTATIONS,
  PARITY_SENSES,
  ParityTractabilitySchema,
  parseParityManifest,
  resolveParityManifestPath,
  SUPPORTED_PARITY_SCHEMA_VERSION,
} from './parity-manifest.js';

// Version-pinned parity drift detector (PR-1, mmnto-ai/totem#2069)
// + mechanical content-equality detector (mmnto-ai/totem#2073 skills slice)
export type {
  CapabilityProbeKind,
  CohortFloorStatus,
  DeriveCohortRepoIdOptions,
  DetectCapabilityProbeContext,
  DetectGeneratedArtifactContext,
  DetectManualAttestationContext,
  DetectMechanicalContext,
  DetectVersionPinnedContext,
  ForkMarker,
  ManagedBlockMarkers,
  PackageJsonShape,
  ParityContractVerdict,
} from './parity-detect.js';
export {
  deriveCohortRepoId,
  detectCapabilityProbeContract,
  detectGeneratedArtifactContract,
  detectManualAttestationContract,
  detectMechanicalContract,
  detectVersionPinnedContract,
  extractManagedBlock,
  hashManagedBlock,
  normalizeManagedBlock,
  packageNameForContract,
  parseForkMarker,
  resolveCohortFloor,
} from './parity-detect.js';

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

// Terminal-injection defense (mmnto-ai/totem#1744 — promoted from cli)
export { sanitizeForTerminal } from './terminal-sanitize.js';

// Pipeline 5 — observation-based auto-capture from shield findings
export type { ObservationInput } from './pipeline-observation.js';
export { deduplicateObservations, generateObservationRule } from './pipeline-observation.js';

// Recurrence-stats schemas + helpers (mmnto-ai/totem#1715)
export type {
  RecurrencePattern,
  RecurrenceSeverityBucket,
  RecurrenceStats,
  RecurrenceTool,
} from './recurrence-stats.js';
export {
  computeSignature,
  jaccard,
  normalizeFindingBody,
  RecurrencePatternSchema,
  RecurrenceSeverityBucketSchema,
  RecurrenceStatsSchema,
  RecurrenceToolSchema,
  tokenizeForJaccard,
  toSeverityBucket,
} from './recurrence-stats.js';

// Retrospect schemas + helpers (mmnto-ai/totem#1713)
export type {
  RetrospectClassification,
  RetrospectFinding,
  RetrospectReport,
  RetrospectRound,
  RetrospectRouteOutReason,
} from './retrospect.js';
export {
  buildStopConditions,
  classifyFinding,
  computeDedupRate,
  groupFindingsByRound,
  RETROSPECT_ROUTE_OUT_REASONS,
  RetrospectClassificationSchema,
  RetrospectFindingSchema,
  RetrospectReportSchema,
  RetrospectRoundSchema,
  RetrospectRouteOutReasonSchema,
  signatureOfBody,
  toCrossPrBucket,
  toRoundPosition,
} from './retrospect.js';

// Spine: Gate-1 wind-tunnel evidence harness (mmnto-ai/totem#2188)
export type { CandidateRuleRecord, ClassifierDisposition } from './spine/candidate-rule.js';
export { CandidateRuleRecordSchema, ClassifierDispositionSchema } from './spine/candidate-rule.js';
// `DraftCandidate` is intentionally NOT re-exported here — it is the transient
// Extract→Classify intermediate (slice 3 maps it to `CandidateRuleRecord`).
// Spine-internal consumers import it directly from './spine/extract.js'; keeping
// it off the public barrel avoids inviting CLI-layer coupling to an ephemeral
// type (greptile #2202). It stays reachable structurally via `ExtractStageResult`.
export type {
  CertCorpusSeed,
  DerivedCorpus,
  LockIntegrityInput,
  PrControlKind,
  PrDiffRole,
  ResolvedPrInput,
} from './spine/cert-corpus-seed.js';
export {
  buildWindtunnelLock,
  CertCorpusSeedError,
  CertCorpusSeedSchema,
  deriveCorpus,
} from './spine/cert-corpus-seed.js';
export type {
  ClassifierResult,
  ClassifyStageDeps,
  ClassifyStageResult,
  DraftClassifier,
} from './spine/classify.js';
export {
  assembleMinerLedgers,
  ClassifierResultSchema,
  dispositionToRouting,
  runClassifyStage,
} from './spine/classify.js';
export type {
  CompiledCandidate,
  CompileOutcome,
  CompileStageDeps,
  CompileStageResult,
} from './spine/compile.js';
export { compileCandidate, runCompileStage } from './spine/compile.js';
export type {
  CorpusDisposition,
  CorpusDispositionComment,
  CorpusDispositionThread,
} from './spine/corpus-dispositions.js';
export {
  CorpusDispositionCommentSchema,
  CorpusDispositionSchema,
  CorpusDispositionsSchema,
  CorpusDispositionThreadSchema,
} from './spine/corpus-dispositions.js';
export type {
  DraftExtractor,
  ExtractStageDeps,
  ExtractStageResult,
  FetchResult,
  ReviewThread,
  ReviewThreadComment,
  ReviewThreadContent,
  ReviewThreadSource,
} from './spine/extract.js';
export { runExtractStage } from './spine/extract.js';
export type {
  ApiFetchSlice,
  ApiUsageLedger,
  ApiUsageLedgerEntry,
  ClassifierLedger,
  ClassifierLedgerEntry,
  DispositionSource,
  DropLedger,
  DropLedgerEntry,
  DropReasonCode,
  EmissionLedger,
  EmissionLedgerEntry,
  MinerLedgers,
  Routing,
  SplitLedger,
} from './spine/ledgers.js';
export {
  ApiFetchSliceSchema,
  ApiUsageLedgerEntrySchema,
  ApiUsageLedgerSchema,
  ClassifierLedgerEntrySchema,
  ClassifierLedgerSchema,
  DispositionSourceSchema,
  DropLedgerEntrySchema,
  DropLedgerSchema,
  DropReasonCodeSchema,
  EmissionLedgerEntrySchema,
  EmissionLedgerSchema,
  MinerLedgersSchema,
  RoutingSchema,
  SplitLedgerSchema,
} from './spine/ledgers.js';
export type {
  LegitimacyProjectionInput,
  LegitimacyProjectionResult,
  LegitimacyProjectionSkip,
} from './spine/legitimacy-projection.js';
export { buildCertifiedRulesFile, projectLegitimacy } from './spine/legitimacy-projection.js';
export type { FalsificationResult, FmClause, FmViolation } from './spine/miner-harness.js';
export { checkParsedLedgers, runFalsificationHarness } from './spine/miner-harness.js';
export type {
  CodePathClassifier,
  PrMeta,
  PrSetDiff,
  SelectionRuleConfig,
} from './spine/selection-rule.js';
export {
  diffPrSets,
  isBotIdentity,
  isCodeTouching,
  parsePrNumber,
  parseRevertSha,
  prSetsEqual,
  resolveSelectionRule,
  SelectionRuleParseError,
  selectionRulePredicate,
} from './spine/selection-rule.js';
export type { SplitArtifact, SplitCoverResult } from './spine/split.js';
export {
  mergeCommitMap,
  resolveSplit,
  SplitArtifactSchema,
  SplitCoverError,
  validateSplitCover,
} from './spine/split.js';
export type {
  BuildFiringsInput,
  BuildFiringsResult,
  FiringLabelCollision,
  PerRuleControlResult,
  ResolvedPrDiff,
} from './spine/windtunnel-firing.js';
export {
  ArchivedRuleInScopeError,
  assertNoArchivedRules,
  assertUniqueFiringLabels,
  buildFirings,
  computePerRuleControlResults,
  FiringLabelCollisionError,
} from './spine/windtunnel-firing.js';
export type { WindtunnelLock } from './spine/windtunnel-lock.js';
export { firingLabelId, WindtunnelLockSchema } from './spine/windtunnel-lock.js';
export type {
  CullLedgerEntry,
  FiringEvidence,
  GroundTruthLabel,
  RuleFiring,
  ScorerInput,
  WindtunnelDiagnostics,
  WindtunnelVerdict,
  WindtunnelVerdictKind,
} from './spine/windtunnel-scorer.js';
export { scoreWindtunnel } from './spine/windtunnel-scorer.js';

// ─── Layer-B cohort-capability ledger (totem-strategy#697) ───────────────────
export type {
  CapabilityFalsificationResult,
  CapabilityFmClause,
  CapabilityFmViolation,
} from './capability/falsification.js';
export { runCapabilityFalsification } from './capability/falsification.js';
export type { RegenerateOptions } from './capability/regenerate.js';
export { regenerateCapabilityLedger } from './capability/regenerate.js';
export type { MinedReviewFinding, ReviewCatchMineResult } from './capability/review-catch.js';
export { mineReviewCatch, resolveActorId } from './capability/review-catch.js';
export type {
  CapabilityClaim,
  CapabilityLedger,
  CapabilityLedgerRow,
  CapabilityProvenance,
  CapabilityResolution,
  Outcome,
  ResolutionSource,
  TaskType,
} from './capability/schema.js';
export {
  CapabilityClaimSchema,
  CapabilityLedgerSchema,
  CapabilityResolutionSchema,
  deriveClaimId,
  OutcomeSchema,
  ResolutionSourceSchema,
  TaskTypeSchema,
} from './capability/schema.js';
