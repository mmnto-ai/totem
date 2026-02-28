import type { Embedder } from './embedder.js';

const DEFAULT_DIMENSIONS = 768;

/**
 * Ollama embedding via the /api/embed endpoint.
 * No SDK required — plain fetch.
 */
export class OllamaEmbedder implements Embedder {
  readonly dimensions = DEFAULT_DIMENSIONS;
  private model: string;
  private baseUrl: string;

  constructor(
    model: string = 'nomic-embed-text',
    baseUrl: string = 'http://localhost:11434',
  ) {
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

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
      throw new Error(
        `[Totem Error] Ollama embedding failed (${response.status}): ${body}\n` +
        `Make sure Ollama is running at ${this.baseUrl} with model '${this.model}' pulled.`,
      );
    }

    const data = (await response.json()) as { embeddings: number[][] };
    return data.embeddings;
  }
}
