import { z } from 'zod';

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

export const ContentTypeSchema = z.enum(['code', 'session_log', 'spec']);

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

export const EmbeddingProviderSchema = z.discriminatedUnion('provider', [
  OpenAIProviderSchema,
  OllamaProviderSchema,
]);

export const DEFAULT_IGNORE_PATTERNS = ['**/node_modules/**', '**/.lancedb/**', '**/dist/**'];

export const ShellOrchestratorSchema = z.object({
  provider: z.literal('shell'),
  /** Shell command with {file} and {model} placeholders */
  command: z.string(),
  /** Default model name substituted for {model} if --model is not passed */
  defaultModel: z.string().optional(),
  /** Optional fallback model used automatically if the primary model fails due to quota/rate limits */
  fallbackModel: z.string().optional(),
  /** Optional per-command model overrides (e.g., { 'spec': 'gemini-3.1-pro-preview' }) */
  overrides: z.record(z.string()).optional(),
  /** Optional per-command cache TTLs in seconds (e.g., { 'triage': 3600, 'shield': 0 }) */
  cacheTtls: z.record(z.number()).optional(),
});

export const OrchestratorSchema = z.discriminatedUnion('provider', [ShellOrchestratorSchema]);

export const TotemConfigSchema = z.object({
  /** Glob patterns and chunking strategies for each ingest target */
  targets: z.array(IngestTargetSchema).min(1),

  /** Embedding provider configuration */
  embedding: EmbeddingProviderSchema,

  /** Optional: LLM orchestrator for spec/triage/shield commands */
  orchestrator: OrchestratorSchema.optional(),

  /** Optional: override the .totem/ directory path */
  totemDir: z.string().default('.totem'),

  /** Optional: override the .lancedb/ directory path */
  lanceDir: z.string().default('.lancedb'),

  /** Optional: glob patterns to exclude from indexing */
  ignorePatterns: z.array(z.string()).default(DEFAULT_IGNORE_PATTERNS),

  /** Character count threshold for MCP context payload warnings (~4 chars ≈ 1 token). Default: 40,000 (~10k tokens). */
  contextWarningThreshold: z.number().int().positive().default(40_000),
});

export type ChunkStrategy = z.infer<typeof ChunkStrategySchema>;
export type ContentType = z.infer<typeof ContentTypeSchema>;
export type IngestTarget = z.infer<typeof IngestTargetSchema>;
export type EmbeddingProvider = z.infer<typeof EmbeddingProviderSchema>;
export type Orchestrator = z.infer<typeof OrchestratorSchema>;
export type TotemConfig = z.infer<typeof TotemConfigSchema>;
