import type { Embedder } from './embedder.js';

const DEFAULT_DIMENSIONS = 768;
const DEFAULT_MODEL = 'text-embedding-004';
const MAX_BATCH_SIZE = 100; // Gemini supports up to 100 texts per batch
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

/** Status codes / error names that are safe to retry. */
const RETRYABLE_STATUS_CODES = new Set([429, 503]);
const RETRYABLE_ERROR_NAMES = new Set(['RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'TOO_MANY_REQUESTS']);

function isRetryableGeminiError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Check for structured status/code on the error object (Gemini SDK attaches these)
  const errObj = err as unknown as Record<string, unknown>;
  if (typeof errObj['status'] === 'number' && RETRYABLE_STATUS_CODES.has(errObj['status'])) {
    return true;
  }
  if (typeof errObj['code'] === 'number' && RETRYABLE_STATUS_CODES.has(errObj['code'])) {
    return true;
  }
  if (typeof errObj['name'] === 'string' && RETRYABLE_ERROR_NAMES.has(errObj['name'])) {
    return true;
  }
  return false;
}

/** Minimal interface for the subset of @google/genai SDK we use. */
interface GeminiAI {
  models: {
    embedContent(req: {
      model: string;
      contents: { parts: { text: string }[] }[];
      config: { taskType: string; outputDimensionality: number };
    }): Promise<{
      embeddings?: { values?: number[] }[];
    }>;
  };
}

/**
 * Dynamically import the @google/genai SDK.
 * It's an optional peer dep in @mmnto/totem — only required when provider is 'gemini'.
 */
async function importGeminiSdk(): Promise<{
  GoogleGenAI: new (opts: { apiKey: string }) => GeminiAI;
}> {
  try {
    // Dynamic import — @google/genai is an optional peer dep
    return await import('@google/genai');
  } catch {
    throw new Error(
      '[Totem Error] Gemini SDK (@google/genai) is not installed.\n' +
        'Install it with: pnpm add @google/genai\n' +
        "Or use provider: 'openai' in your embedding config.",
    );
  }
}

/**
 * Gemini embedding via the @google/genai SDK.
 * Supports task-type awareness for retrieval-optimized embeddings.
 */
export class GeminiEmbedder implements Embedder {
  readonly dimensions: number;
  private model: string;
  private apiKey: string;

  constructor(model: string = DEFAULT_MODEL, dimensions?: number) {
    this.model = model;
    this.dimensions = dimensions ?? DEFAULT_DIMENSIONS;

    const apiKey = process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_API_KEY'];
    if (!apiKey) {
      throw new Error(
        '[Totem Error] No Gemini API key found.\n' +
          'Set GEMINI_API_KEY (or GOOGLE_API_KEY) in your .env file.',
      );
    }

    this.apiKey = apiKey;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const { GoogleGenAI } = await importGeminiSdk();
    const ai = new GoogleGenAI({ apiKey: this.apiKey });

    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE);
      const embeddings = await this.embedWithRetry(ai, batch);
      results.push(...embeddings);
    }

    return results;
  }

  private async embedWithRetry(ai: GeminiAI, batch: string[]): Promise<number[][]> {
    let lastErr: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await ai.models.embedContent({
          model: this.model,
          contents: batch.map((text: string) => ({ parts: [{ text }] })),
          config: {
            taskType: 'RETRIEVAL_DOCUMENT',
            outputDimensionality: this.dimensions,
          },
        });

        if (!response.embeddings || response.embeddings.length !== batch.length) {
          throw new Error(
            `Expected ${batch.length} embeddings, got ${response.embeddings?.length ?? 0}`,
          );
        }

        return response.embeddings.map((e: { values?: number[] }) => {
          if (!e.values) throw new Error('Embedding response missing values');
          return e.values;
        });
      } catch (err) {
        lastErr = err;
        if (!isRetryableGeminiError(err) || attempt === MAX_RETRIES) break;
        const delay = INITIAL_BACKOFF_MS * 2 ** attempt + Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(
      `[Totem Error] Gemini embedding failed after ${MAX_RETRIES + 1} attempts: ${message}`,
    );
  }
}
