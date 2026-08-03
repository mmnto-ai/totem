import OpenAI from 'openai';

import { TotemConfigError, TotemError } from '../errors.js';
import type { Embedder } from './embedder.js';
import { createRequestPacer } from './pacing.js';

const MAX_BATCH_SIZE = 2048;
const DEFAULT_DIMENSIONS = 1536;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

export class OpenAIEmbedder implements Embedder {
  readonly dimensions: number;
  private client: OpenAI;
  private model: string;
  private pace: () => Promise<void>;

  constructor(
    model: string = 'text-embedding-3-small',
    dimensions?: number,
    throttleMs: number = 0,
  ) {
    this.model = model;
    this.dimensions = dimensions ?? DEFAULT_DIMENSIONS;
    this.pace = createRequestPacer(throttleMs);

    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      throw new TotemConfigError(
        'No OpenAI API key found.',
        "Set OPENAI_API_KEY in your .env or configure provider: 'ollama' in totem.config.ts.",
        'CONFIG_MISSING',
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
        // Pace every attempt (mmnto-ai/totem#2562): the throttle exists for
        // per-minute limits, and retries count against them like any request.
        await this.pace();
        return await this.client.embeddings.create({
          model: this.model,
          input: batch,
        });
      } catch (err) {
        lastErr = err;
        const isRetryable =
          err instanceof OpenAI.APIError && (err.status === 429 || err.status === 503);
        if (!isRetryable || attempt === MAX_RETRIES) break;
        const delay = INITIAL_BACKOFF_MS * 2 ** attempt + Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
    // Rate-limit exhaustion gets its own recovery hint (mmnto-ai/totem#2562):
    // the key-and-network hint is wrong there, and an interrupted full
    // re-index now resumes from its checkpoint on the next `totem sync`.
    const hint =
      lastErr instanceof OpenAI.APIError && lastErr.status === 429
        ? 'Embedding rate limit exhausted. Re-run `totem sync` — an interrupted full re-index resumes from its checkpoint instead of restarting. To stay under per-minute limits, set `embedding.throttleMs` in totem.config.ts to pace requests.'
        : 'Check your OPENAI_API_KEY and network connection, then retry with `totem sync`.';
    throw new TotemError(
      'EMBEDDING_UNAVAILABLE',
      `OpenAI embedding failed after ${MAX_RETRIES + 1} attempts: ${detail}`,
      hint,
    );
  }
}
