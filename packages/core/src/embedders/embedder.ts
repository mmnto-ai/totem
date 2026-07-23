import type { EmbeddingProvider } from '../config-schema.js';
import { TotemConfigError } from '../errors.js';
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

const OLLAMA_DEFAULTS = {
  model: 'nomic-embed-text',
  baseUrl: 'http://localhost:11434',
  dimensions: 768,
};

/**
 * Probe the Ollama daemon's `/api/tags` endpoint to determine whether it's
 * reachable. Used internally by `LazyEmbedder`'s fallback chain and exported
 * for `totem doctor`'s floor-expectation diagnostic (mmnto-ai/totem#1851).
 *
 * Never throws — network errors, timeouts, ECONNREFUSED, and non-2xx
 * responses all resolve to `false`. Bounded by a 3-second `AbortSignal`
 * timeout.
 */
export async function isOllamaAvailable(
  baseUrl: string = OLLAMA_DEFAULTS.baseUrl,
): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Try to construct the configured embedder. Uses dynamic import so missing
 * SDKs throw at import time rather than requiring CJS require().
 */
async function tryBuildEmbedder(config: EmbeddingProvider): Promise<Embedder> {
  if (config.provider === 'openai') {
    const { OpenAIEmbedder } = await import('./openai-embedder.js');
    return new OpenAIEmbedder(config.model, config.dimensions);
  }
  if (config.provider === 'gemini') {
    const { GeminiEmbedder, importGeminiSdk } = await import('./gemini-embedder.js');
    // mmnto-ai/totem#1859: resolve the @google/genai SDK BEFORE constructing — the
    // explicit analog of openai-embedder.ts's top-level `import OpenAI`, which resolves
    // the SDK before its constructor runs. GeminiEmbedder loads SDK-free by design
    // (dynamic import inside embed()), so without this probe a missing SDK slips past
    // construction and hard-errors at embed() time — past the fallback boundary, so
    // LazyEmbedder never gets to fall back to Ollama. Probing first (ahead of the
    // constructor's API-key check) gives full parity with openai: when both the SDK and
    // the key are absent, the SDK-missing error surfaces first, exactly as openai's
    // static import fails ahead of its own key check.
    await importGeminiSdk();
    return new GeminiEmbedder(config.model, config.dimensions);
  }
  throw new TotemConfigError(
    `Unknown embedding provider: ${config.provider}`,
    "Check totem.config.ts — valid providers: 'openai', 'gemini', 'ollama'.",
    'CONFIG_INVALID',
  );
}

/**
 * Create an embedder from config. If the configured provider's SDK or API key
 * is missing, falls back to Ollama. If Ollama isn't available either, throws
 * a clear error.
 *
 * Returns synchronously via a lazy proxy that resolves on first embed() call.
 *
 * @param onWarn Optional callback for fallback warnings (defaults to a no-op)
 */
export function createEmbedder(
  config: EmbeddingProvider,
  onWarn?: (msg: string) => void,
): Embedder {
  // Ollama is always direct — no SDK, no API key
  if (config.provider === 'ollama') {
    return new OllamaEmbedder(config.model, config.baseUrl, config.dimensions);
  }

  return new LazyEmbedder(config, onWarn);
}

/**
 * The terminal "no embedder anywhere" failure message. Exported as the single
 * source of truth because `LanceStore.isNoEmbedderError` keys its opt-in FTS
 * degradation on recognizing exactly this failure (mmnto-ai/totem#2463) — a
 * wording change here propagates to the detector instead of silently
 * decoupling it.
 */
export const NO_EMBEDDER_AVAILABLE_MESSAGE =
  'No embedding provider available. The configured provider failed and Ollama is not running.';

/**
 * Lazy embedder that resolves the real provider on first embed() call.
 * If the configured provider fails (missing SDK / API key), falls back to Ollama.
 * Dimensions are optimistic — set to the configured provider's default.
 * If a fallback occurs, the dimension mismatch warning tells the user to rebuild.
 */
class LazyEmbedder implements Embedder {
  readonly dimensions: number;
  private initPromise: Promise<Embedder> | null = null;
  private config: EmbeddingProvider;
  private warn: (msg: string) => void;

  constructor(config: EmbeddingProvider, onWarn?: (msg: string) => void) {
    this.config = config;
    this.warn = onWarn ?? (() => {});
    // Use configured dimensions or provider defaults
    this.dimensions = config.dimensions ?? (config.provider === 'gemini' ? 768 : 1536);
  }

  /** Resolve the real embedder once. Concurrent callers share the same promise. */
  private resolve(): Promise<Embedder> {
    if (!this.initPromise) {
      this.initPromise = this.doResolve();
    }
    return this.initPromise;
  }

  private async doResolve(): Promise<Embedder> {
    try {
      return await tryBuildEmbedder(this.config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.warn(
        `[Totem] ${this.config.provider} embedder unavailable: ${msg}\n` +
          `[Totem] Falling back to Ollama (${OLLAMA_DEFAULTS.model})...`,
      );

      const available = await isOllamaAvailable();
      if (!available) {
        throw new TotemConfigError(
          NO_EMBEDDER_AVAILABLE_MESSAGE,
          "Either: (1) Install the SDK and set the API key for your configured provider, (2) Install and start Ollama: https://ollama.com, or (3) Set provider: 'ollama' in totem.config.ts.",
          'CONFIG_MISSING',
        );
      }

      this.warn(
        `[Totem] Using Ollama fallback embedder (${OLLAMA_DEFAULTS.model}, ${OLLAMA_DEFAULTS.dimensions}d).\n` +
          '[Totem] If your index was built with a different provider, run `totem sync --full` to rebuild.',
      );
      return new OllamaEmbedder(
        OLLAMA_DEFAULTS.model,
        OLLAMA_DEFAULTS.baseUrl,
        OLLAMA_DEFAULTS.dimensions,
      );
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    const inner = await this.resolve();
    return inner.embed(texts);
  }
}
