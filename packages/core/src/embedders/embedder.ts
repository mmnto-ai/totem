import type { EmbeddingProvider } from '../config-schema.js';
import { OpenAIEmbedder } from './openai-embedder.js';
import { OllamaEmbedder } from './ollama-embedder.js';

/**
 * All embedding providers implement this interface.
 */
export interface Embedder {
  /** The dimensionality of vectors produced by this embedder */
  readonly dimensions: number;

  /**
   * Embed a batch of texts. Returns one vector per input text.
   * Implementations should handle batching/rate-limiting internally.
   */
  embed(texts: string[]): Promise<number[][]>;
}

export function createEmbedder(config: EmbeddingProvider): Embedder {
  switch (config.provider) {
    case 'openai':
      return new OpenAIEmbedder(config.model, config.dimensions);
    case 'ollama':
      return new OllamaEmbedder(config.model, config.baseUrl, config.dimensions);
  }
}
