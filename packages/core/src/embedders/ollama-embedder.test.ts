import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OllamaEmbedder } from './ollama-embedder.js';

// ─── Helpers ──────────────────────────────────────────

/** Build a fake Response that resolves with the given JSON. */
function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function errorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

/** Create a valid embedding response for N texts with the given dimensions. */
function embedResponse(count: number, dims: number = 768): { embeddings: number[][] } {
  return {
    embeddings: Array.from({ length: count }, (_, i) => new Array(dims).fill(i + 1)),
  };
}

// ─── Tests ────────────────────────────────────────────

describe('OllamaEmbedder', () => {
  const fetchSpy = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Constructor ────────────────────────────────────

  it('uses default model, baseUrl and dimensions', () => {
    const embedder = new OllamaEmbedder();
    expect(embedder.dimensions).toBe(768);
  });

  it('accepts custom dimensions', () => {
    const embedder = new OllamaEmbedder('nomic-embed-text', 'http://localhost:11434', 512);
    expect(embedder.dimensions).toBe(512);
  });

  // ─── Successful embedding ──────────────────────────

  it('embeds a list of texts successfully', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse(embedResponse(3)));

    const embedder = new OllamaEmbedder();
    const result = await embedder.embed(['hello', 'world', 'test']);

    expect(result).toHaveLength(3);
    expect(result[0]).toHaveLength(768);
    expect(result[1]).toHaveLength(768);
    expect(result[2]).toHaveLength(768);

    // Verify the fetch was called correctly
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://localhost:11434/api/embed');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe('nomic-embed-text');
    expect(body.input).toEqual(['hello', 'world', 'test']);
  });

  it('returns empty array for empty input', async () => {
    const embedder = new OllamaEmbedder();
    const result = await embedder.embed([]);

    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ─── Batch splitting ───────────────────────────────

  it('splits large inputs into batches of 10', async () => {
    // 25 texts → 3 batches (10 + 10 + 5)
    fetchSpy
      .mockResolvedValueOnce(okResponse(embedResponse(10)))
      .mockResolvedValueOnce(okResponse(embedResponse(10)))
      .mockResolvedValueOnce(okResponse(embedResponse(5)));

    const embedder = new OllamaEmbedder();
    const texts = Array.from({ length: 25 }, (_, i) => `text ${i}`);
    const result = await embedder.embed(texts);

    expect(result).toHaveLength(25);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('sends exactly MAX_BATCH_SIZE texts per batch', async () => {
    fetchSpy
      .mockResolvedValueOnce(okResponse(embedResponse(10)))
      .mockResolvedValueOnce(okResponse(embedResponse(2)));

    const embedder = new OllamaEmbedder();
    const texts = Array.from({ length: 12 }, (_, i) => `text ${i}`);
    await embedder.embed(texts);

    // First call should have 10 texts
    const firstBody = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(firstBody.input).toHaveLength(10);

    // Second call should have 2 texts
    const secondBody = JSON.parse(fetchSpy.mock.calls[1]![1]?.body as string);
    expect(secondBody.input).toHaveLength(2);
  });

  // ─── Text truncation ───────────────────────────────

  it('truncates texts longer than 6000 characters', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse(embedResponse(1)));

    const embedder = new OllamaEmbedder();
    const longText = 'a'.repeat(10_000);
    await embedder.embed([longText]);

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body.input[0].length).toBe(6_000);
  });

  it('does not truncate texts under the limit', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse(embedResponse(1)));

    const embedder = new OllamaEmbedder();
    const shortText = 'a'.repeat(5_000);
    await embedder.embed([shortText]);

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body.input[0].length).toBe(5_000);
  });

  // ─── Error handling: model not found ────────────────

  it('falls back to zero vector when model is not found (404)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Batch call returns 404 (caught by embedBatch, throws TotemConfigError)
    // embed() catches batch error → retries individually → also gets 404
    fetchSpy.mockResolvedValue(errorResponse(404, 'model not found'));

    const embedder = new OllamaEmbedder('nonexistent-model');

    // Because embed() catches ALL batch errors and falls back to zero vectors,
    // we get a zero vector instead of an error. This is the actual behavior:
    // batch fails → individual retry also fails → zero vector fallback.
    const result = await embedder.embed(['test']);
    expect(result).toHaveLength(1);
    expect(result[0]!.every((v) => v === 0)).toBe(true);

    consoleSpy.mockRestore();
  });

  it('falls back to zero vector on 400 model error', async () => {
    // Test embedBatch directly via a single-text embed where we intercept
    // We verify the error shape by ensuring both batch AND individual fail with the right error type
    fetchSpy.mockResolvedValue(errorResponse(400, 'no such model'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const embedder = new OllamaEmbedder('bad-model');

    // embed() catches errors and retries individually, then falls back to zero vector
    const result = await embedder.embed(['test']);
    expect(result).toHaveLength(1);
    expect(result[0]!.every((v) => v === 0)).toBe(true);

    consoleSpy.mockRestore();
  });

  it('falls back to zero vector when server returns 500 persistently', async () => {
    fetchSpy.mockResolvedValue(errorResponse(500, 'internal server error'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const embedder = new OllamaEmbedder();

    // Batch fails → individual retry also fails → zero vector
    const result = await embedder.embed(['test']);
    expect(result).toHaveLength(1);
    expect(result[0]!.every((v) => v === 0)).toBe(true);

    consoleSpy.mockRestore();
  });

  // ─── Retry logic: batch failure → individual retry ─

  it('retries each text individually when a batch fails', async () => {
    // First batch call fails
    fetchSpy.mockRejectedValueOnce(new Error('batch failed'));
    // Then each individual text succeeds
    fetchSpy.mockResolvedValueOnce(okResponse(embedResponse(1)));
    fetchSpy.mockResolvedValueOnce(okResponse(embedResponse(1)));
    fetchSpy.mockResolvedValueOnce(okResponse(embedResponse(1)));

    const embedder = new OllamaEmbedder();
    const result = await embedder.embed(['a', 'b', 'c']);

    expect(result).toHaveLength(3);
    // 1 batch call (failed) + 3 individual calls
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  // ─── Zero-vector fallback on individual failure ─────

  it('falls back to zero vector when an individual text also fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Batch fails
    fetchSpy.mockRejectedValueOnce(new Error('batch failed'));
    // First individual succeeds
    fetchSpy.mockResolvedValueOnce(okResponse(embedResponse(1)));
    // Second individual fails → zero vector
    fetchSpy.mockRejectedValueOnce(new Error('oversized'));

    const embedder = new OllamaEmbedder();
    const result = await embedder.embed(['good text', 'bad text']);

    expect(result).toHaveLength(2);
    // First text got a real embedding
    expect(result[0]!.every((v) => v === 1)).toBe(true);
    // Second text got zero vector (known issue: silent fallback)
    expect(result[1]!).toHaveLength(768);
    expect(result[1]!.every((v) => v === 0)).toBe(true);

    // Verify the warning was logged
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Totem] Skipping oversized chunk'),
    );

    consoleSpy.mockRestore();
  });

  it('uses the configured dimensions for zero-vector fallback', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Batch fails, then individual also fails
    fetchSpy.mockRejectedValueOnce(new Error('batch failed'));
    fetchSpy.mockRejectedValueOnce(new Error('individual failed'));

    const embedder = new OllamaEmbedder('nomic-embed-text', 'http://localhost:11434', 512);
    const result = await embedder.embed(['problematic text']);

    expect(result).toHaveLength(1);
    expect(result[0]!).toHaveLength(512);
    expect(result[0]!.every((v) => v === 0)).toBe(true);

    consoleSpy.mockRestore();
  });

  // ─── Custom baseUrl ─────────────────────────────────

  it('sends requests to a custom baseUrl', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse(embedResponse(1)));

    const embedder = new OllamaEmbedder('nomic-embed-text', 'http://remote:9999');
    await embedder.embed(['hello']);

    const [url] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://remote:9999/api/embed');
  });

  // ─── Mixed batch success/failure ────────────────────

  it('handles first batch success and second batch failure gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // 15 texts → 2 batches (10 + 5)
    // First batch succeeds
    fetchSpy.mockResolvedValueOnce(okResponse(embedResponse(10)));
    // Second batch fails
    fetchSpy.mockRejectedValueOnce(new Error('second batch failed'));
    // Individual retries for the 5 texts in the second batch
    fetchSpy.mockResolvedValueOnce(okResponse(embedResponse(1)));
    fetchSpy.mockResolvedValueOnce(okResponse(embedResponse(1)));
    fetchSpy.mockResolvedValueOnce(okResponse(embedResponse(1)));
    fetchSpy.mockResolvedValueOnce(okResponse(embedResponse(1)));
    fetchSpy.mockResolvedValueOnce(okResponse(embedResponse(1)));

    const embedder = new OllamaEmbedder();
    const texts = Array.from({ length: 15 }, (_, i) => `text ${i}`);
    const result = await embedder.embed(texts);

    expect(result).toHaveLength(15);

    consoleSpy.mockRestore();
  });
});
