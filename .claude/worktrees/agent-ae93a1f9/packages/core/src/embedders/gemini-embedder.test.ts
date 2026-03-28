import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TotemConfigError, TotemError } from '../errors.js';
import { GeminiEmbedder } from './gemini-embedder.js';

// ─── Mock the @google/genai SDK ───────────────────────

const mockEmbedContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { embedContent: mockEmbedContent };
  },
}));

// ─── Helpers ──────────────────────────────────────────

/** Build a successful embedContent response for N texts. */
function embedResponse(count: number, dims: number = 768): { embeddings: { values: number[] }[] } {
  return {
    embeddings: Array.from({ length: count }, (_, i) => ({
      values: new Array(dims).fill(i + 1),
    })),
  };
}

// ─── Tests ────────────────────────────────────────────

describe('GeminiEmbedder', () => {
  beforeEach(() => {
    process.env['GEMINI_API_KEY'] = 'test-gemini-key';
    mockEmbedContent.mockReset();
    // Mock setTimeout to resolve immediately (avoids fake timer issues in turbo builds)
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: () => void) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
  });

  afterEach(() => {
    delete process.env['GEMINI_API_KEY'];
    delete process.env['GOOGLE_API_KEY'];
    vi.restoreAllMocks();
  });

  // ─── Constructor ──────────────────────────────────────

  it('throws TotemConfigError with no API key', () => {
    delete process.env['GEMINI_API_KEY'];
    expect(() => new GeminiEmbedder()).toThrow(TotemConfigError);
  });

  it('accepts GEMINI_API_KEY', () => {
    expect(() => new GeminiEmbedder()).not.toThrow();
  });

  it('accepts GOOGLE_API_KEY as fallback', () => {
    delete process.env['GEMINI_API_KEY'];
    process.env['GOOGLE_API_KEY'] = 'google-key';
    expect(() => new GeminiEmbedder()).not.toThrow();
  });

  // ─── Successful embedding ──────────────────────────

  it('embeds a list of texts successfully', async () => {
    mockEmbedContent.mockResolvedValueOnce(embedResponse(3));

    const embedder = new GeminiEmbedder();
    const result = await embedder.embed(['hello', 'world', 'test']);

    expect(result).toHaveLength(3);
    expect(result[0]).toHaveLength(768);

    expect(mockEmbedContent).toHaveBeenCalledTimes(1);
    const call = mockEmbedContent.mock.calls[0]![0];
    expect(call.model).toBe('gemini-embedding-2-preview');
    expect(call.contents).toEqual([
      { parts: [{ text: 'hello' }] },
      { parts: [{ text: 'world' }] },
      { parts: [{ text: 'test' }] },
    ]);
    expect(call.config.taskType).toBe('RETRIEVAL_DOCUMENT');
    expect(call.config.outputDimensionality).toBe(768);
  });

  it('returns empty array for empty input', async () => {
    const embedder = new GeminiEmbedder();
    const result = await embedder.embed([]);

    expect(result).toEqual([]);
    expect(mockEmbedContent).not.toHaveBeenCalled();
  });

  // ─── Batch splitting ───────────────────────────────

  it('splits inputs larger than 100 into batches', async () => {
    mockEmbedContent
      .mockResolvedValueOnce(embedResponse(100))
      .mockResolvedValueOnce(embedResponse(50));

    const embedder = new GeminiEmbedder();
    const texts = Array.from({ length: 150 }, (_, i) => `text ${i}`);
    const result = await embedder.embed(texts);

    expect(result).toHaveLength(150);
    expect(mockEmbedContent).toHaveBeenCalledTimes(2);
    expect(mockEmbedContent.mock.calls[0]![0].contents).toHaveLength(100);
    expect(mockEmbedContent.mock.calls[1]![0].contents).toHaveLength(50);
  });

  // ─── Retry logic: retryable errors ─────────────────

  it('retries on 429 (rate limit) and succeeds', async () => {
    const rateLimitErr = Object.assign(new Error('rate limited'), { status: 429 });
    mockEmbedContent.mockRejectedValueOnce(rateLimitErr).mockResolvedValueOnce(embedResponse(1));

    const embedder = new GeminiEmbedder();
    const result = await embedder.embed(['hello']);

    expect(result).toHaveLength(1);
    expect(mockEmbedContent).toHaveBeenCalledTimes(2);
  });

  it('retries on 503 (unavailable) and succeeds', async () => {
    const unavailableErr = Object.assign(new Error('service unavailable'), { status: 503 });
    mockEmbedContent.mockRejectedValueOnce(unavailableErr).mockResolvedValueOnce(embedResponse(2));

    const embedder = new GeminiEmbedder();
    const result = await embedder.embed(['a', 'b']);

    expect(result).toHaveLength(2);
    expect(mockEmbedContent).toHaveBeenCalledTimes(2);
  });

  it('retries on RESOURCE_EXHAUSTED error name', async () => {
    const exhaustedErr = Object.assign(new Error('quota exceeded'), {
      name: 'RESOURCE_EXHAUSTED',
    });
    mockEmbedContent.mockRejectedValueOnce(exhaustedErr).mockResolvedValueOnce(embedResponse(1));

    const embedder = new GeminiEmbedder();
    const result = await embedder.embed(['test']);

    expect(result).toHaveLength(1);
    expect(mockEmbedContent).toHaveBeenCalledTimes(2);
  });

  it('retries up to MAX_RETRIES (3) times before giving up', async () => {
    const rateLimitErr = Object.assign(new Error('rate limited'), { status: 429 });
    mockEmbedContent
      .mockRejectedValueOnce(rateLimitErr)
      .mockRejectedValueOnce(rateLimitErr)
      .mockRejectedValueOnce(rateLimitErr)
      .mockRejectedValueOnce(rateLimitErr);

    const embedder = new GeminiEmbedder();

    await expect(embedder.embed(['test'])).rejects.toThrow(TotemError);
    expect(mockEmbedContent).toHaveBeenCalledTimes(4);
  });

  // ─── Non-retryable errors ──────────────────────────

  it('does not retry on non-retryable errors', async () => {
    const authErr = Object.assign(new Error('unauthorized'), { status: 401 });
    mockEmbedContent.mockRejectedValueOnce(authErr);

    const embedder = new GeminiEmbedder();

    await expect(embedder.embed(['test'])).rejects.toThrow('unauthorized');
    expect(mockEmbedContent).toHaveBeenCalledTimes(1);
  });

  // ─── Response validation ───────────────────────────

  it('throws when response has wrong embedding count', async () => {
    mockEmbedContent.mockResolvedValueOnce(embedResponse(1)); // asked for 2

    const embedder = new GeminiEmbedder();

    await expect(embedder.embed(['a', 'b'])).rejects.toThrow('Expected 2 embeddings');
  });

  it('throws when response has missing embeddings', async () => {
    mockEmbedContent.mockResolvedValueOnce({ embeddings: undefined });

    const embedder = new GeminiEmbedder();

    await expect(embedder.embed(['a'])).rejects.toThrow('Expected 1 embeddings');
  });

  it('throws when embedding values are missing', async () => {
    mockEmbedContent.mockResolvedValueOnce({
      embeddings: [{ values: undefined }],
    });

    const embedder = new GeminiEmbedder();

    await expect(embedder.embed(['a'])).rejects.toThrow('missing values');
  });

  // ─── Custom model ──────────────────────────────────

  it('uses custom model name', async () => {
    mockEmbedContent.mockResolvedValueOnce(embedResponse(1));

    const embedder = new GeminiEmbedder('custom-model');
    await embedder.embed(['test']);

    expect(mockEmbedContent.mock.calls[0]![0].model).toBe('custom-model');
  });
});
