import { TotemConfigError, TotemError } from '../errors.js';
import { buildMissingSdkHint } from '../missing-sdk.js';
import type { Embedder } from './embedder.js';
import { createRequestPacer } from './pacing.js';

const DEFAULT_DIMENSIONS = 768;
const DEFAULT_MODEL = 'gemini-embedding-2-preview';
const MAX_BATCH_SIZE = 100; // Gemini supports up to 100 texts per batch
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
// Cap on a server-advised retry delay — a pathological RetryInfo hint must not
// stall the run; bounds worst-case retry wall-clock at ~MAX_RETRIES minutes.
const MAX_SERVER_RETRY_DELAY_MS = 60_000;
// The Vertex quota that kills unthrottled syncs is a PER-MINUTE window
// (ground-read 2026-08-03, mmnto-ai/totem#2562: online_prediction_requests_
// per_base_model = 2,000/min default for gemini-embedding-2, accounting
// consistent with per-content-item). Derived default pacing: 100-item batches
// every 4s = 1,500 items/min — under the window with margin. A run that never
// throttles converges on a corpus of ANY size in corpus/1500 minutes instead
// of dying at ~2k. Explicit `throttleMs: 0` disables pacing.
const DEFAULT_THROTTLE_MS = 4_000;
// Quota retries without a server-advised delay must back off PAST the minute
// boundary — 1–4s backoff burns the whole retry budget inside the same closed
// window that produced the 429.
const QUOTA_WINDOW_BACKOFF_MS = 60_000;

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

/**
 * Quota-class failure (429 / RESOURCE_EXHAUSTED): the one retryable class
 * where "check your API key and network" is the WRONG recovery hint
 * (mmnto-ai/totem#2562) — the key works; the per-minute allowance is spent.
 */
export function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const errObj = err as unknown as Record<string, unknown>;
  if (errObj['status'] === 429 || errObj['code'] === 429) return true;
  return /RESOURCE_EXHAUSTED|TOO_MANY_REQUESTS/.test(`${String(errObj['name'])} ${err.message}`);
}

/**
 * Extract a server-advised retry delay from a Gemini SDK error, if present.
 * 429s carry google.rpc.RetryInfo either as a structured `errorDetails` entry
 * (`retryDelay: "18s"`) or embedded in the message JSON. Against a per-minute
 * quota this is the difference between the retry budget being real and being
 * decorative — 1–4s exponential backoff never outlives the window. Capped at
 * MAX_SERVER_RETRY_DELAY_MS; returns null when absent (caller falls back to
 * exponential backoff).
 */
export function extractRetryDelayMs(err: unknown): number | null {
  if (!(err instanceof Error)) return null;
  const details = (err as unknown as Record<string, unknown>)['errorDetails'];
  if (Array.isArray(details)) {
    for (const entry of details) {
      const delay = (entry as Record<string, unknown>)['retryDelay'];
      if (typeof delay === 'string') {
        const seconds = delay.match(/^(\d+(?:\.\d+)?)s$/);
        if (seconds) return Math.min(Number(seconds[1]) * 1000, MAX_SERVER_RETRY_DELAY_MS);
      }
    }
  }
  const inMessage = err.message.match(/["']?retryDelay["']?\s*:\s*["'](\d+(?:\.\d+)?)s["']/);
  if (inMessage) return Math.min(Number(inMessage[1]) * 1000, MAX_SERVER_RETRY_DELAY_MS);
  return null;
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
export async function importGeminiSdk(): Promise<{
  GoogleGenAI: new (opts: { apiKey: string }) => GeminiAI;
}> {
  try {
    // Dynamic import — @google/genai is an optional peer dep
    return await import('@google/genai');
  } catch {
    // mmnto-ai/totem#2018 L2: the remediation must branch on context — "pnpm add"
    // is the wrong fix when the SDK is already installed and the BINARY can't see
    // it, and the provider alternative only applies when the SDK is genuinely
    // absent (the openai provider needs its own externalized SDK, which would be
    // just as unresolvable from a foreign binary — #2150 round-2).
    throw new TotemConfigError(
      'Gemini SDK (@google/genai) is not installed.',
      buildMissingSdkHint('@google/genai', {
        absentAlternative:
          "Alternatively use provider: 'openai' in your embedding config (requires the openai package).",
      }),
      'CONFIG_MISSING',
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
  private pace: () => Promise<void>;

  constructor(
    model: string = DEFAULT_MODEL,
    dimensions?: number,
    throttleMs: number = DEFAULT_THROTTLE_MS,
  ) {
    this.model = model;
    this.dimensions = dimensions ?? DEFAULT_DIMENSIONS;
    this.pace = createRequestPacer(throttleMs);

    const apiKey = process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_API_KEY'];
    if (!apiKey) {
      throw new TotemConfigError(
        'No Gemini API key found.',
        'Set GEMINI_API_KEY (or GOOGLE_API_KEY) in your .env file.',
        'CONFIG_MISSING',
      );
    }

    this.apiKey = apiKey;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const { GoogleGenAI } = await importGeminiSdk();
    const ai = new GoogleGenAI({ apiKey: this.apiKey });

    // Pace only ingest-shaped calls (falsification round 3, MAJOR 3): sync
    // flushes arrive as multi-text batches and are what burns the per-minute
    // window; a single-text call is a QUERY (search / MCP retrieval, whose
    // embedder is process-lifetime cached) and pacing it would tax every
    // interactive lookup for quota it cannot meaningfully consume.
    const paceThisCall = texts.length > 1;

    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE);
      const embeddings = await this.embedWithRetry(ai, batch, paceThisCall);
      results.push(...embeddings);
    }

    return results;
  }

  private async embedWithRetry(
    ai: GeminiAI,
    batch: string[],
    paceThisCall: boolean,
  ): Promise<number[][]> {
    let lastErr: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Pace every attempt (mmnto-ai/totem#2562): the throttle exists for
        // per-minute quotas, and retries count against them like any request.
        if (paceThisCall) await this.pace();
        const response = await ai.models.embedContent({
          model: this.model,
          contents: batch.map((text: string) => ({ parts: [{ text }] })),
          config: {
            taskType: 'RETRIEVAL_DOCUMENT',
            outputDimensionality: this.dimensions,
          },
        });

        if (!response.embeddings || response.embeddings.length !== batch.length) {
          throw new TotemError(
            'EMBEDDING_UNAVAILABLE',
            `Expected ${batch.length} embeddings, got ${response.embeddings?.length ?? 0}`,
            'This may be a transient Gemini API issue. Retry with `totem sync`.',
          );
        }

        return response.embeddings.map((e: { values?: number[] }) => {
          if (!e.values)
            throw new TotemError(
              'EMBEDDING_UNAVAILABLE',
              'Embedding response missing values',
              'This may be a transient Gemini API issue. Retry with `totem sync`.',
            );
          return e.values;
        });
        // totem-context: intentional capture — the retry loop stores the error and EVERY exit path rethrows it as the terminal TotemError below (mmnto-ai/totem#2562); nothing is swallowed.
      } catch (err) {
        lastErr = err;
        if (!isRetryableGeminiError(err) || attempt === MAX_RETRIES) break;
        // Delay selection (mmnto-ai/totem#2562, falsification round 2 F4 +
        // the per-minute ground-read): a server-advised RetryInfo delay wins
        // when it is LONGER than the exponential backoff (never shorter — a
        // "0s"/"0.001s" advisory must not collapse the budget into a burst);
        // a quota 429 with NO advisory waits out the minute window instead of
        // burning all retries inside the window that produced it.
        const backoff = INITIAL_BACKOFF_MS * 2 ** attempt + Math.random() * 1000;
        const advised = extractRetryDelayMs(err);
        const delay =
          advised !== null
            ? Math.max(advised, backoff)
            : isQuotaError(err)
              ? Math.max(backoff, QUOTA_WINDOW_BACKOFF_MS)
              : backoff;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
    // Quota exhaustion gets its own recovery hint (mmnto-ai/totem#2562): the
    // key-and-network hint is actively wrong there, and since #2562 a plain
    // `totem sync` after an interrupted full re-index RESUMES from the
    // checkpoint — that recovery is now true, so name it.
    const hint = isQuotaError(lastErr)
      ? 'Embedding quota exhausted (e.g. per-minute request quota). Re-run `totem sync` — an interrupted full re-index resumes from its checkpoint instead of restarting. To stay under per-minute quotas, set `embedding.throttleMs` in totem.config.ts to pace requests.'
      : 'Check your GEMINI_API_KEY and network connection, then retry with `totem sync`.';
    throw new TotemError(
      'EMBEDDING_UNAVAILABLE',
      `Gemini embedding failed after ${MAX_RETRIES + 1} attempts: ${detail}`,
      hint,
    );
  }
}
