import OpenAI from 'openai';

import type { Embedder } from './embedder.js';

const MAX_BATCH_SIZE = 2048;
const DEFAULT_DIMENSIONS = 1536;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

export class OpenAIEmbedder implements Embedder {
  readonly dimensions: number;
  private client: OpenAI;
  private model: string;

  constructor(model: string = 'text-embedding-3-small', dimensions?: number) {
    this.model = model;
    this.dimensions = dimensions ?? DEFAULT_DIMENSIONS;

    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      throw new Error(
        '[Totem Error] No embedding provider configured.\n' +
          "Set OPENAI_API_KEY in your .env or configure 'ollama' in totem.config.ts.",
      );
    }

    this.client = new OpenAI({ apiKey });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE);
      const response = await this.embedWithRetry(batch);

      const sorted = response.data.sort((a, b) => a.index - b.index);
      for (const item of sorted) {
        results.push(item.embedding);
      }
    }

    return results;
  }

  private async embedWithRetry(
    batch: string[],
  ): Promise<OpenAI.Embeddings.CreateEmbeddingResponse> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.client.embeddings.create({
          model: this.model,
          input: batch,
        });
      } catch (err) {
        lastErr = err;
        const isRetryable =
          err instanceof OpenAI.APIError && (err.status === 429 || err.status === 503);
        if (!isRetryable || attempt === MAX_RETRIES) break;
        const delay = INITIAL_BACKOFF_MS * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(`[Totem Error] OpenAI embedding failed after ${MAX_RETRIES + 1} attempts: ${message}`);
  }
}
