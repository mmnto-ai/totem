import { afterEach, describe, expect, it, vi } from 'vitest';

import { invokeOllamaOrchestrator } from './ollama-orchestrator.js';

// ─── Mocks ──────────────────────────────────────────

vi.mock('../ui.js', () => ({
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(), dim: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

afterEach(() => {
  mockFetch.mockReset();
});

// ─── Tests ──────────────────────────────────────────

describe('invokeOllamaOrchestrator', () => {
  const baseOpts = {
    prompt: 'test prompt',
    model: 'gemma2:27b',
    cwd: '.',
    tag: 'Test',
    totemDir: '.totem',
  };

  const okResponse = (body: object) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  it('returns structured result from Ollama', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        message: { content: 'Hello from Ollama' },
        prompt_eval_count: 150,
        eval_count: 50,
        done: true,
        done_reason: 'stop',
      }),
    );

    const result = await invokeOllamaOrchestrator(baseOpts);

    expect(result.content).toBe('Hello from Ollama');
    expect(result.inputTokens).toBe(150);
    expect(result.outputTokens).toBe(50);
    expect(result.finishReason).toBe('stop');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('passes num_ctx in options when configured', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ message: { content: 'ok' }, done: true }));

    await invokeOllamaOrchestrator({ ...baseOpts, numCtx: 8192 });

    const [, fetchOpts] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(fetchOpts.body);
    expect(body.options).toEqual({ num_ctx: 8192 });
  });

  it('omits options.num_ctx when not configured', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ message: { content: 'ok' }, done: true }));

    await invokeOllamaOrchestrator(baseOpts);

    const [, fetchOpts] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(fetchOpts.body);
    expect(body.options).toBeUndefined();
  });

  it('defaults baseUrl to localhost:11434', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ message: { content: 'ok' }, done: true }));

    await invokeOllamaOrchestrator(baseOpts);

    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe('http://localhost:11434/api/chat');
  });

  it('uses custom baseUrl and strips trailing slash', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ message: { content: 'ok' }, done: true }));

    await invokeOllamaOrchestrator({ ...baseOpts, baseUrl: 'http://myserver:11434/' });

    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe('http://myserver:11434/api/chat');
  });

  it('sends model and prompt in correct Ollama format', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ message: { content: 'ok' }, done: true }));

    await invokeOllamaOrchestrator(baseOpts);

    const [, fetchOpts] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(fetchOpts.body);
    expect(body.model).toBe('gemma2:27b');
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([{ role: 'user', content: 'test prompt' }]);
  });

  it('requests non-streaming response', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ message: { content: 'ok' }, done: true }));

    await invokeOllamaOrchestrator(baseOpts);

    const [, fetchOpts] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(fetchOpts.body);
    expect(body.stream).toBe(false);
  });

  it('throws connection error when Ollama is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(invokeOllamaOrchestrator(baseOpts)).rejects.toThrow('Cannot connect to Ollama');
  });

  it('suggests ollama serve in connection error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(invokeOllamaOrchestrator(baseOpts)).rejects.toSatisfy((err: Error) => {
      return (
        err.message.includes('Cannot connect to Ollama') &&
        'recoveryHint' in err &&
        (err as { recoveryHint: string }).recoveryHint.includes('ollama serve')
      );
    });
  });

  it('throws VRAM-friendly error on 500 with numCtx', async () => {
    mockFetch.mockResolvedValueOnce(new Response('out of memory', { status: 500 }));

    await expect(invokeOllamaOrchestrator({ ...baseOpts, numCtx: 32768 })).rejects.toSatisfy(
      (err: Error) => {
        return (
          'recoveryHint' in err &&
          (err as { recoveryHint: string }).recoveryHint.includes('lowering numCtx')
        );
      },
    );
  });

  it('throws QuotaError on 429 responses', async () => {
    mockFetch.mockResolvedValueOnce(new Response('too many requests', { status: 429 }));

    await expect(invokeOllamaOrchestrator(baseOpts)).rejects.toSatisfy((err: Error) => {
      return err.name === 'QuotaError' && err.message.includes('Ollama rate limit');
    });
  });

  it('throws VRAM-friendly error on 500 without numCtx', async () => {
    mockFetch.mockResolvedValueOnce(new Response('out of memory', { status: 500 }));

    await expect(invokeOllamaOrchestrator(baseOpts)).rejects.toSatisfy((err: Error) => {
      return (
        'recoveryHint' in err &&
        (err as { recoveryHint: string }).recoveryHint.includes('smaller numCtx')
      );
    });
  });

  it('handles missing token counts gracefully', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ message: { content: 'no counts' }, done: true }));

    const result = await invokeOllamaOrchestrator(baseOpts);

    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
  });

  it('handles missing message content', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ message: {}, done: true }));

    const result = await invokeOllamaOrchestrator(baseOpts);
    expect(result.content).toBe('');
  });

  it('throws model-not-installed for 404 with model not found', async () => {
    mockFetch.mockResolvedValueOnce(new Response('model not found', { status: 404 }));

    await expect(invokeOllamaOrchestrator(baseOpts)).rejects.toThrow(
      "Ollama model 'gemma2:27b' is not installed",
    );
  });

  it('throws friendly error on non-JSON response body', async () => {
    mockFetch.mockResolvedValueOnce(new Response('not json at all', { status: 200 }));

    await expect(invokeOllamaOrchestrator(baseOpts)).rejects.toThrow(
      'Ollama returned invalid JSON',
    );
  });

  it('throws friendly error on malformed JSON response', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([{ unexpected: 'array' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(invokeOllamaOrchestrator(baseOpts)).rejects.toThrow(
      'Unexpected response from Ollama API',
    );
  });
});
