import OpenAI from 'openai';

import type { Embedder } from './embedder.js';

const MAX_BATCH_SIZE = 2048;
const DEFAULT_DIMENSIONS = 1536;

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
      const response = await this.client.embeddings.create({
        model: this.model,
        input: batch,
      });

      const sorted = response.data.sort((a, b) => a.index - b.index);
      for (const item of sorted) {
        results.push(item.embedding);
      }
    }

    return results;
  }
}
