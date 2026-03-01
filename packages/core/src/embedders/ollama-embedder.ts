import { z } from 'zod';

import type { Embedder } from './embedder.js';

const DEFAULT_DIMENSIONS = 768;
const MAX_BATCH_SIZE = 10;
const MAX_CHARS_PER_TEXT = 6_000; // ~2000 tokens, conservative for nomic-embed-text's 8192 context

/**
 * Ollama embedding via the /api/embed endpoint.
 * No SDK required — plain fetch.
 */
export class OllamaEmbedder implements Embedder {
  readonly dimensions: number;
  private model: string;
  private baseUrl: string;

  constructor(
    model: string = 'nomic-embed-text',
    baseUrl: string = 'http://localhost:11434',
    dimensions?: number,
  ) {
    this.model = model;
    this.baseUrl = baseUrl;
    this.dimensions = dimensions ?? DEFAULT_DIMENSIONS;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`[Totem Error] Ollama embedding failed (${response.status}): ${body}`);
    }

    const data = z
      .object({ embeddings: z.array(z.array(z.number())) })
      .parse(await response.json());
    return data.embeddings;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Truncate oversized texts to stay within model context window
    const truncated = texts.map((t) =>
      t.length > MAX_CHARS_PER_TEXT ? t.slice(0, MAX_CHARS_PER_TEXT) : t,
    );

    const results: number[][] = [];

    // Batch to avoid overwhelming Ollama with large payloads
    for (let i = 0; i < truncated.length; i += MAX_BATCH_SIZE) {
      const batch = truncated.slice(i, i + MAX_BATCH_SIZE);

      try {
        const embeddings = await this.embedBatch(batch);
        results.push(...embeddings);
      } catch {
        // Batch failed — retry each text individually
        for (const text of batch) {
          try {
            const [embedding] = await this.embedBatch([text]);
            results.push(embedding!);
          } catch {
            // Individual text exceeds context — use zero vector
            console.error(
              `[Totem] Skipping oversized chunk (${text.length} chars): ${text.slice(0, 60)}...`,
            );
            results.push(new Array(this.dimensions).fill(0));
          }
        }
      }
    }

    return results;
  }
}
