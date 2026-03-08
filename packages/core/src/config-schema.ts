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

export const DocTargetSchema = z.object({
  /** Relative path to the document */
  path: z.string(),
  /** Description of the document's purpose (included in the LLM prompt) */
  description: z.string(),
  /** When to remind/auto-run: 'post-release' or 'on-change' */
  trigger: z.enum(['post-release', 'on-change']).default('post-release'),
});

export const ConfigTierSchema = z.enum(['lite', 'standard', 'full']);
export type ConfigTier = z.infer<typeof ConfigTierSchema>;

export const TotemConfigSchema = z.object({
  /** Glob patterns and chunking strategies for each ingest target */
  targets: z.array(IngestTargetSchema).min(1),

  /** Embedding provider configuration (optional for Lite tier) */
  embedding: EmbeddingProviderSchema.optional(),

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

  /** Optional: documents to auto-update via `totem docs` */
  docs: z.array(DocTargetSchema).optional(),
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
    throw new Error(
      `[Totem Error] No embedding provider configured.\n` +
        `This command requires embeddings (Lite tier does not support it).\n` +
        `Set OPENAI_API_KEY in your .env and re-run \`totem init\`, or add an 'embedding' block to totem.config.ts.`,
    );
  }
  return config.embedding;
}
