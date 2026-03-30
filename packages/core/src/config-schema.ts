import { z } from 'zod';

import { TotemConfigError } from './errors.js';
import { CustomSecretSchema } from './secrets.js';

/**
 * Zod schema for totem.config.ts — lives at the root of consuming projects.
 */

export const ChunkStrategySchema = z.enum([
  'typescript-ast',
  'markdown-heading',
  'session-log',
  'schema-file',
  'test-file',
]);

export const ContentTypeSchema = z.enum(['code', 'session_log', 'spec', 'lesson']);

export const IngestTargetSchema = z.object({
  glob: z.string(),
  type: ContentTypeSchema,
  strategy: ChunkStrategySchema,
});

export const OpenAIProviderSchema = z.object({
  provider: z.literal('openai'),
  model: z.string().default('text-embedding-3-small'),
  dimensions: z.number().int().positive().optional(),
});

export const OllamaProviderSchema = z.object({
  provider: z.literal('ollama'),
  model: z.string().default('nomic-embed-text'),
  baseUrl: z.string().default('http://localhost:11434'),
  dimensions: z.number().int().positive().optional(),
});

export const GeminiProviderSchema = z.object({
  provider: z.literal('gemini'),
  model: z.string().default('gemini-embedding-2-preview'),
  dimensions: z.number().int().positive().optional(),
});

export const EmbeddingProviderSchema = z.discriminatedUnion('provider', [
  OpenAIProviderSchema,
  OllamaProviderSchema,
  GeminiProviderSchema,
]);

export const DEFAULT_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.lancedb/**',
  '**/dist/**',
  '**/__tests__/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
];

// ─── Orchestrator schemas ────────────────────────────

/** Fields shared across all orchestrator providers */
const BaseOrchestratorFields = {
  /** Default model name if --model is not passed */
  defaultModel: z.string().optional(),
  /** Fallback model used automatically if the primary model fails due to quota/rate limits */
  fallbackModel: z.string().optional(),
  /** Per-command model overrides (e.g., { 'spec': 'gemini-3.1-pro-preview' }) */
  overrides: z.record(z.string()).optional(),
  /** Per-command cache TTLs in seconds (e.g., { 'triage': 3600, 'shield': 0 }) */
  cacheTtls: z.record(z.number()).optional(),
};

export const ShellOrchestratorSchema = z.object({
  provider: z.literal('shell'),
  /** Shell command with {file} and {model} placeholders */
  command: z.string(),
  ...BaseOrchestratorFields,
});

export const GeminiOrchestratorSchema = z.object({
  provider: z.literal('gemini'),
  ...BaseOrchestratorFields,
});

export const AnthropicOrchestratorSchema = z.object({
  provider: z.literal('anthropic'),
  ...BaseOrchestratorFields,
});

export const OpenAIOrchestratorSchema = z.object({
  provider: z.literal('openai'),
  /** Optional base URL for OpenAI-compatible servers (Ollama, LM Studio, etc.) */
  baseUrl: z.string().url().optional(),
  ...BaseOrchestratorFields,
});

export const OllamaOrchestratorSchema = z.object({
  provider: z.literal('ollama'),
  /** Base URL for the Ollama server */
  baseUrl: z.string().default('http://localhost:11434'),
  /** Context length passed to Ollama as num_ctx (controls KV cache / VRAM usage) */
  numCtx: z.number().int().positive().optional(),
  ...BaseOrchestratorFields,
});

export const OrchestratorSchema = z.discriminatedUnion('provider', [
  ShellOrchestratorSchema,
  GeminiOrchestratorSchema,
  AnthropicOrchestratorSchema,
  OpenAIOrchestratorSchema,
  OllamaOrchestratorSchema,
]);

/**
 * Auto-migrate legacy orchestrator configs that lack a `provider` field.
 * If `command` is present without `provider`, injects `provider: 'shell'`.
 */
function autoMigrateOrchestrator(val: unknown): unknown {
  if (
    val &&
    typeof val === 'object' &&
    !Array.isArray(val) &&
    'command' in val &&
    !('provider' in val)
  ) {
    return { ...(val as Record<string, unknown>), provider: 'shell' };
  }
  return val;
}

export const DocTargetSchema = z.object({
  /** Relative path to the document */
  path: z.string(),
  /** Description of the document's purpose (included in the LLM prompt) */
  description: z.string(),
  /** When to remind/auto-run: 'post-release' or 'on-change' */
  trigger: z.enum(['post-release', 'on-change']).default('post-release'),
  /** Whether this doc receives user-facing post-processing (issue ref stripping, manual content, live metrics). Defaults to true for readme.md files. */
  userFacing: z.boolean().optional(),
});

export const ConfigTierSchema = z.enum(['lite', 'standard', 'full']);
export type ConfigTier = z.infer<typeof ConfigTierSchema>;

export const TotemConfigSchema = z.object({
  /** Glob patterns and chunking strategies for each ingest target */
  targets: z.array(IngestTargetSchema).min(1),

  /** Embedding provider configuration (optional for Lite tier) */
  embedding: EmbeddingProviderSchema.optional(),

  /** Optional: LLM orchestrator for spec/triage/shield commands */
  orchestrator: z.preprocess(autoMigrateOrchestrator, OrchestratorSchema).optional(),

  /** Optional: override the .totem/ directory path */
  totemDir: z
    .string()
    .default('.totem')
    .refine((p) => !/^(\/|\\|[A-Za-z]:)/.test(p), 'totemDir must be a relative path'),

  /** Optional: override the .lancedb/ directory path */
  lanceDir: z
    .string()
    .default('.lancedb')
    .refine((p) => !/^(\/|\\|[A-Za-z]:)/.test(p), 'lanceDir must be a relative path'),

  /** Optional: glob patterns to exclude from indexing */
  ignorePatterns: z.array(z.string()).default(DEFAULT_IGNORE_PATTERNS),

  /** Optional: additional glob patterns to exclude from deterministic shield scanning (merged with ignorePatterns) */
  shieldIgnorePatterns: z.array(z.string()).optional().default([]),

  /** Character count threshold for MCP context payload warnings (~4 chars ≈ 1 token). Default: 40,000 (~10k tokens). */
  contextWarningThreshold: z.number().int().positive().default(40_000),

  /** Optional: documents to auto-update via `totem docs` */
  docs: z.array(DocTargetSchema).optional(),

  /** Optional: export targets for cross-model lesson enforcement (e.g., { gemini: '.gemini/styleguide.md' }) */
  exports: z.record(z.string()).optional(),

  /** Optional: GitHub repositories to aggregate issues from (e.g., ['owner/repo', 'owner/repo2']) */
  repositories: z.array(z.string()).optional(),

  /** Optional: bot boilerplate markers to filter from PR comments during `totem extract` (e.g., ['Using Gemini Code Assist', 'Copilot']) */
  botMarkers: z.array(z.string()).optional(),

  /** Optional: paths to other totem-managed directories whose indexes should be queried alongside this one (e.g., ['.strategy', '../docs-repo']) */
  linkedIndexes: z.array(z.string()).optional(),

  /** Optional: named partitions mapping logical aliases to file path prefixes for context isolation (e.g., { core: ['packages/core/'], mcp: ['packages/mcp/'] }) */
  partitions: z.record(z.array(z.string().min(1)).min(1)).optional(),

  /** Optional: custom secret patterns for DLP redaction (shared, version-controlled) */
  secrets: z.array(CustomSecretSchema).optional(),
});

export type ChunkStrategy = z.infer<typeof ChunkStrategySchema>;
export type ContentType = z.infer<typeof ContentTypeSchema>;
export type IngestTarget = z.infer<typeof IngestTargetSchema>;
export type EmbeddingProvider = z.infer<typeof EmbeddingProviderSchema>;
export type Orchestrator = z.infer<typeof OrchestratorSchema>;
export type DocTarget = z.infer<typeof DocTargetSchema>;
export type TotemConfig = z.infer<typeof TotemConfigSchema>;

/**
 * Determine the configuration tier based on what's configured.
 * - lite: no embedding, no orchestrator (memory-only features)
 * - standard: embedding configured (sync, search, stats)
 * - full: embedding + orchestrator (all commands)
 */
export function getConfigTier(config: TotemConfig): ConfigTier {
  if (!config.embedding) return 'lite';
  if (!config.orchestrator) return 'standard';
  return 'full';
}

/**
 * Assert that an embedding provider is configured. Throws a friendly error
 * directing the user to configure one via `totem init` or `totem.config.ts`.
 */
export function requireEmbedding(config: TotemConfig): EmbeddingProvider {
  if (!config.embedding) {
    throw new TotemConfigError(
      'No embedding provider configured. This command requires embeddings (Lite tier does not support it).',
      "Set OPENAI_API_KEY or GEMINI_API_KEY in your .env and re-run 'totem init'.",
    );
  }
  return config.embedding;
}
