import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TotemConfigError, TotemError } from '../errors.js';
import { extractRetryDelayMs, GeminiEmbedder, isQuotaError } from './gemini-embedder.js';

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

  // ─── Quota recovery hint (#2562) ───────────────────

  it('terminal 429 failure carries the quota hint naming resume and throttleMs', async () => {
    const rateLimitErr = Object.assign(new Error('rate limited'), { status: 429 });
    mockEmbedContent.mockRejectedValue(rateLimitErr);

    const embedder = new GeminiEmbedder();
    await expect(embedder.embed(['test'])).rejects.toMatchObject({
      recoveryHint: expect.stringMatching(/resumes from its checkpoint.*throttleMs/s),
    });
  });

  it('terminal non-quota failure keeps the key-and-network hint', async () => {
    const badErr = Object.assign(new Error('service unavailable'), { status: 503 });
    mockEmbedContent.mockRejectedValue(badErr);

    const embedder = new GeminiEmbedder();
    await expect(embedder.embed(['test'])).rejects.toMatchObject({
      recoveryHint: expect.stringContaining('GEMINI_API_KEY'),
    });
  });

  // ─── Server-advised retry delay (#2562) ────────────

  it('waits the server-advised retryDelay instead of exponential backoff on 429', async () => {
    const delays: (number | undefined)[] = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      delays.push(ms);
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as never);

    const quotaErr = Object.assign(new Error('rate limited'), {
      status: 429,
      errorDetails: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '18s' }],
    });
    mockEmbedContent.mockRejectedValueOnce(quotaErr).mockResolvedValueOnce(embedResponse(1));

    const embedder = new GeminiEmbedder(undefined, undefined, 0);
    await embedder.embed(['test']);

    expect(delays).toContain(18_000);
  });

  it.each(['0s', '0.5s'])(
    'a sub-backoff server advisory ("%s") never undercuts the exponential floor',
    async (advisory) => {
      const delays: (number | undefined)[] = [];
      vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
        delays.push(ms);
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as never);

      const quotaErr = Object.assign(new Error('rate limited'), {
        status: 429,
        errorDetails: [{ retryDelay: advisory }],
      });
      mockEmbedContent.mockRejectedValueOnce(quotaErr).mockResolvedValueOnce(embedResponse(1));

      const embedder = new GeminiEmbedder(undefined, undefined, 0);
      await embedder.embed(['test']);

      expect(delays).toHaveLength(1);
      expect(delays[0]!).toBeGreaterThanOrEqual(1000); // INITIAL_BACKOFF_MS floor
    },
  );

  it('a quota 429 with NO advisory backs off past the minute window', async () => {
    const delays: (number | undefined)[] = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      delays.push(ms);
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as never);

    const quotaErr = Object.assign(new Error('quota exceeded RESOURCE_EXHAUSTED'), { status: 429 });
    mockEmbedContent.mockRejectedValueOnce(quotaErr).mockResolvedValueOnce(embedResponse(1));

    const embedder = new GeminiEmbedder(undefined, undefined, 0);
    await embedder.embed(['test']);

    // The 2,000/min quota is a rolling 60s window — fast retries die inside
    // the window that produced the 429 (ground-read 2026-08-03).
    expect(delays.some((d) => d !== undefined && d >= 60_000)).toBe(true);
  });

  // ─── Request pacing (#2562) ────────────────────────

  it('throttleMs paces successive ingest-shaped calls; explicit 0 disables pacing', async () => {
    const delays: (number | undefined)[] = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      delays.push(ms);
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as never);

    mockEmbedContent.mockResolvedValue(embedResponse(2));

    const unpaced = new GeminiEmbedder(undefined, undefined, 0);
    await unpaced.embed(['a', 'b']);
    await unpaced.embed(['c', 'd']);
    expect(delays).toHaveLength(0);

    const paced = new GeminiEmbedder(undefined, undefined, 5_000);
    await paced.embed(['a', 'b']);
    await paced.embed(['c', 'd']); // within 5s of the first call — must wait
    expect(delays.length).toBeGreaterThanOrEqual(1);
    const wait = delays[delays.length - 1]!;
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(5_000);
  });

  it('pacing defaults ON at the derived per-minute-window constant (#2562 ground-read)', async () => {
    const delays: (number | undefined)[] = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      delays.push(ms);
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as never);

    mockEmbedContent.mockResolvedValue(embedResponse(2));

    // No throttleMs given — the gemini default (4s between batches ≈ 1,500
    // items/min at 100-item batches) must pace the second ingest-shaped call
    // at close to the full constant (the magnitude IS the convergence claim).
    const embedder = new GeminiEmbedder();
    await embedder.embed(['a', 'b']);
    await embedder.embed(['c', 'd']);
    expect(delays.length).toBeGreaterThanOrEqual(1);
    const wait = delays[delays.length - 1]!;
    expect(wait).toBeGreaterThan(3_900);
    expect(wait).toBeLessThanOrEqual(4_000);
  });

  it('single-text (query-shaped) calls are never paced, even at the default throttle (#2562 round 3)', async () => {
    const delays: (number | undefined)[] = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      delays.push(ms);
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as never);

    mockEmbedContent.mockResolvedValue(embedResponse(1));

    // A process-lifetime embedder (the MCP server) serves sequential search
    // queries — pacing those would tax every interactive lookup.
    const embedder = new GeminiEmbedder();
    await embedder.embed(['query one']);
    await embedder.embed(['query two']);
    await embedder.embed(['query three']);
    expect(delays).toHaveLength(0);
  });
});

// ─── Quota-error classification (#2562) ──────────────

describe('isQuotaError', () => {
  it.each([
    ['status 429', Object.assign(new Error('x'), { status: 429 }), true],
    ['code 429', Object.assign(new Error('x'), { code: 429 }), true],
    ['RESOURCE_EXHAUSTED in message', new Error('got RESOURCE_EXHAUSTED from upstream'), true],
    [
      'RESOURCE_EXHAUSTED name',
      Object.assign(new Error('x'), { name: 'RESOURCE_EXHAUSTED' }),
      true,
    ],
    ['503 unavailable', Object.assign(new Error('unavailable'), { status: 503 }), false],
    ['401 auth', Object.assign(new Error('unauthorized'), { status: 401 }), false],
    ['non-error', 'RESOURCE_EXHAUSTED', false],
  ])('%s', (_label, err, expected) => {
    expect(isQuotaError(err)).toBe(expected);
  });
});

// ─── RetryInfo extraction (#2562) ────────────────────

describe('extractRetryDelayMs', () => {
  it('reads a structured errorDetails RetryInfo entry', () => {
    const err = Object.assign(new Error('quota'), {
      errorDetails: [
        { '@type': 'type.googleapis.com/google.rpc.BadRequest' },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '18s' },
      ],
    });
    expect(extractRetryDelayMs(err)).toBe(18_000);
  });

  it('falls back to a retryDelay embedded in the message JSON', () => {
    const err = new Error('429 {"error":{"details":[{"retryDelay":"7s"}]}}');
    expect(extractRetryDelayMs(err)).toBe(7_000);
  });

  it('supports fractional seconds', () => {
    const err = Object.assign(new Error('quota'), {
      errorDetails: [{ retryDelay: '2.5s' }],
    });
    expect(extractRetryDelayMs(err)).toBe(2_500);
  });

  it('caps a pathological delay at 60s', () => {
    const err = Object.assign(new Error('quota'), {
      errorDetails: [{ retryDelay: '3600s' }],
    });
    expect(extractRetryDelayMs(err)).toBe(60_000);
  });

  it('returns null when no delay is present (caller uses exponential backoff)', () => {
    expect(extractRetryDelayMs(new Error('plain rate limited'))).toBeNull();
    expect(extractRetryDelayMs('not an error')).toBeNull();
  });
});
