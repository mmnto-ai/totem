import type { EmbeddingProvider } from '../config-schema.js';
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
 * Check if Ollama is reachable by pinging its API.
 */
async function isOllamaAvailable(baseUrl: string = OLLAMA_DEFAULTS.baseUrl): Promise<boolean> {
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
 * Create an embedder from config. If the configured provider's SDK or API key
 * is missing, falls back to Ollama. If Ollama isn't available either, throws
 * a clear error.
 *
 * @param onWarn Optional callback for fallback warnings (defaults to console.error)
 */
export function createEmbedder(
  config: EmbeddingProvider,
  onWarn?: (msg: string) => void,
): Embedder {
  const warn = onWarn ?? ((msg: string) => console.error(msg));

  // Ollama is always direct — no SDK, no API key
  if (config.provider === 'ollama') {
    return new OllamaEmbedder(config.model, config.baseUrl, config.dimensions);
  }

  try {
    if (config.provider === 'openai') {
      // Static import of 'openai' — will throw if package not installed
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { OpenAIEmbedder } = require('./openai-embedder.js') as {
        OpenAIEmbedder: new (model?: string, dimensions?: number) => Embedder;
      };
      return new OpenAIEmbedder(config.model, config.dimensions);
    }

    if (config.provider === 'gemini') {
      // Dynamic import happens inside GeminiEmbedder.embed(), but the
      // constructor checks for API key synchronously.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { GeminiEmbedder } = require('./gemini-embedder.js') as {
        GeminiEmbedder: new (model?: string, dimensions?: number) => Embedder;
      };
      return new GeminiEmbedder(config.model, config.dimensions);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn(
      `[Totem] ${config.provider} embedder unavailable: ${msg}\n` +
        `[Totem] Falling back to Ollama (${OLLAMA_DEFAULTS.model})...`,
    );
    return new OllamaFallbackEmbedder(warn);
  }

  // Exhaustive — should never reach here
  throw new Error(
    `[Totem Error] Unknown embedding provider: ${(config as { provider: string }).provider}`,
  );
}

/**
 * Lazy Ollama embedder that checks availability on first use.
 * This avoids blocking createEmbedder() with an async check.
 */
class OllamaFallbackEmbedder implements Embedder {
  readonly dimensions = OLLAMA_DEFAULTS.dimensions;
  private inner: OllamaEmbedder | null = null;
  private checked = false;
  private warn: (msg: string) => void;

  constructor(warn: (msg: string) => void) {
    this.warn = warn;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.checked) {
      this.checked = true;
      const available = await isOllamaAvailable();
      if (!available) {
        throw new Error(
          '[Totem Error] No embedding provider available.\n' +
            'The configured provider failed and Ollama is not running.\n' +
            'Either:\n' +
            '  1. Install the SDK and set the API key for your configured provider\n' +
            '  2. Install and start Ollama: https://ollama.com\n' +
            "  3. Set provider: 'ollama' in totem.config.ts embedding config",
        );
      }
      this.warn(
        `[Totem] Using Ollama fallback embedder (${OLLAMA_DEFAULTS.model}, ${OLLAMA_DEFAULTS.dimensions}d).\n` +
          '[Totem] If your index was built with a different provider, run `totem sync --full` to rebuild.',
      );
      this.inner = new OllamaEmbedder(
        OLLAMA_DEFAULTS.model,
        OLLAMA_DEFAULTS.baseUrl,
        OLLAMA_DEFAULTS.dimensions,
      );
    }

    if (!this.inner) {
      // Checked but not available — should have thrown above
      throw new Error('[Totem Error] Ollama fallback embedder not initialized.');
    }

    return this.inner.embed(texts);
  }
}
