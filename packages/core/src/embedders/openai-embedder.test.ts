import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TotemConfigError } from '../errors.js';
import { OpenAIEmbedder } from './openai-embedder.js';

// ─── Mock the openai SDK ──────────────────────────────

const { mockCreate, MockAPIError } = vi.hoisted(() => {
  const mockCreate = vi.fn();
  class MockAPIError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { mockCreate, MockAPIError };
});

vi.mock('openai', () => {
  class OpenAI {
    static APIError = MockAPIError;
    embeddings = { create: mockCreate };
  }
  return { default: OpenAI };
});

/** Build a successful embeddings.create response for N texts. */
function embedResponse(
  count: number,
  dims: number = 1536,
): {
  data: { index: number; embedding: number[] }[];
} {
  return {
    data: Array.from({ length: count }, (_, i) => ({
      index: i,
      embedding: new Array(dims).fill(i + 1),
    })),
  };
}

describe('OpenAIEmbedder', () => {
  beforeEach(() => {
    process.env['OPENAI_API_KEY'] = 'test-openai-key';
    mockCreate.mockReset();
    // Immediate-invoke setTimeout: retries and pacing resolve without waiting
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as never);
  });

  afterEach(() => {
    delete process.env['OPENAI_API_KEY'];
    vi.restoreAllMocks();
  });

  it('throws TotemConfigError with no API key', () => {
    delete process.env['OPENAI_API_KEY'];
    expect(() => new OpenAIEmbedder()).toThrow(TotemConfigError);
  });

  it('embeds a list of texts successfully', async () => {
    mockCreate.mockResolvedValueOnce(embedResponse(2));

    const embedder = new OpenAIEmbedder();
    const result = await embedder.embed(['a', 'b']);

    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(1536);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  // ─── Quota recovery hint (#2562) ───────────────────

  it('terminal 429 failure carries the quota hint naming resume and throttleMs', async () => {
    mockCreate.mockRejectedValue(new MockAPIError(429, 'rate limited'));

    const embedder = new OpenAIEmbedder();
    await expect(embedder.embed(['test'])).rejects.toMatchObject({
      recoveryHint: expect.stringMatching(/resumes from its checkpoint.*throttleMs/s),
    });
    expect(mockCreate).toHaveBeenCalledTimes(4); // MAX_RETRIES + 1
  });

  it('terminal non-retryable failure keeps the key-and-network hint', async () => {
    mockCreate.mockRejectedValue(new MockAPIError(401, 'unauthorized'));

    const embedder = new OpenAIEmbedder();
    await expect(embedder.embed(['test'])).rejects.toMatchObject({
      recoveryHint: expect.stringContaining('OPENAI_API_KEY'),
    });
    expect(mockCreate).toHaveBeenCalledTimes(1); // not retryable
  });

  // ─── Request pacing (#2562) ────────────────────────

  it('throttleMs paces successive API calls; 0 adds no waits', async () => {
    const delays: (number | undefined)[] = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      delays.push(ms);
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as never);

    mockCreate.mockResolvedValue(embedResponse(2));

    const unpaced = new OpenAIEmbedder();
    await unpaced.embed(['a', 'b']);
    await unpaced.embed(['c', 'd']);
    expect(delays).toHaveLength(0);

    const paced = new OpenAIEmbedder(undefined, undefined, 5_000);
    await paced.embed(['a', 'b']);
    await paced.embed(['c', 'd']); // within 5s of the first call — must wait
    expect(delays.length).toBeGreaterThanOrEqual(1);
    const wait = delays[delays.length - 1]!;
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(5_000);

    // Single-text (query-shaped) calls never pace, even with a throttle set.
    const queryDelays = delays.length;
    await paced.embed(['a lone query']);
    await paced.embed(['another query']);
    expect(delays.length).toBe(queryDelays);
  });
});
