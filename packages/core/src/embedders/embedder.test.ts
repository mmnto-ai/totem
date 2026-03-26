import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EmbeddingProvider } from '../config-schema.js';
import { createEmbedder } from './embedder.js';

// ─── Mock OpenAI embedder ──────────────────────────

vi.mock('./openai-embedder.js', () => ({
  OpenAIEmbedder: class {
    dimensions = 1536;
    private callCount = 0;
    async embed(texts: string[]): Promise<number[][]> {
      // Simulate async work
      await new Promise((r) => setTimeout(r, 10));
      this.callCount++;
      return texts.map(() => new Array(1536).fill(this.callCount));
    }
  },
}));

// ─── Tests ─────────────────────────────────────────

describe('createEmbedder', () => {
  afterEach(() => {
    delete process.env['OPENAI_API_KEY'];
  });

  it('returns an embedder for ollama (direct, no lazy wrapper)', () => {
    const config: EmbeddingProvider = {
      provider: 'ollama',
      model: 'nomic-embed-text',
      baseUrl: 'http://localhost:11434',
    };
    const embedder = createEmbedder(config);
    expect(embedder.dimensions).toBe(768);
  });

  it('returns a lazy embedder for openai', () => {
    // Force env so constructor doesn't throw
    process.env['OPENAI_API_KEY'] = 'test-key';
    const config: EmbeddingProvider = { provider: 'openai', model: 'text-embedding-3-small' };
    const embedder = createEmbedder(config);
    expect(embedder.dimensions).toBe(1536);
    delete process.env['OPENAI_API_KEY'];
  });
});

describe('LazyEmbedder concurrency', () => {
  afterEach(() => {
    delete process.env['OPENAI_API_KEY'];
  });

  it('concurrent embed() calls share the same init promise (no race condition)', async () => {
    process.env['OPENAI_API_KEY'] = 'test-key';
    const config: EmbeddingProvider = { provider: 'openai', model: 'text-embedding-3-small' };
    const embedder = createEmbedder(config);

    // Fire 3 concurrent embed calls — this is exactly what hybridSearch does
    const [r1, r2, r3] = await Promise.all([
      embedder.embed(['a']),
      embedder.embed(['b']),
      embedder.embed(['c']),
    ]);

    // All should succeed without "Cannot read properties of null"
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
    expect(r3).toHaveLength(1);

    delete process.env['OPENAI_API_KEY'];
  });
});
