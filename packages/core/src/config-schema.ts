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

export const ContentTypeSchema = z.enum([
  'code',
  'session_log',
  'spec',
]);

export const IngestTargetSchema = z.object({
  glob: z.string(),
  type: ContentTypeSchema,
  strategy: ChunkStrategySchema,
});

export const OpenAIProviderSchema = z.object({
  provider: z.literal('openai'),
  model: z.string().default('text-embedding-3-small'),
});

export const OllamaProviderSchema = z.object({
  provider: z.literal('ollama'),
  model: z.string().default('nomic-embed-text'),
  baseUrl: z.string().default('http://localhost:11434'),
});

export const EmbeddingProviderSchema = z.discriminatedUnion('provider', [
  OpenAIProviderSchema,
  OllamaProviderSchema,
]);

export const TotemConfigSchema = z.object({
  /** Glob patterns and chunking strategies for each ingest target */
  targets: z.array(IngestTargetSchema).min(1),

  /** Embedding provider configuration */
  embedding: EmbeddingProviderSchema,

  /** Optional: override the .totem/ directory path */
  totemDir: z.string().default('.totem'),

  /** Optional: override the .lancedb/ directory path */
  lanceDir: z.string().default('.lancedb'),
});

export type ChunkStrategy = z.infer<typeof ChunkStrategySchema>;
export type ContentType = z.infer<typeof ContentTypeSchema>;
export type IngestTarget = z.infer<typeof IngestTargetSchema>;
export type EmbeddingProvider = z.infer<typeof EmbeddingProviderSchema>;
export type TotemConfig = z.infer<typeof TotemConfigSchema>;
