import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invokeOpenAIOrchestrator } from './openai-orchestrator.js';

// ─── Mock SDK ───────────────────────────────────────

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mockCreate } };
  },
}));

vi.mock('../ui.js', () => ({
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(), dim: vi.fn() },
}));

// ─── Tests ──────────────────────────────────────────

describe('invokeOpenAIOrchestrator', () => {
  const baseOpts = {
    prompt: 'test prompt',
    model: 'gpt-4o',
    cwd: '.',
    tag: 'Test',
    totemDir: '.totem',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['OPENAI_API_KEY'] = 'test-key';
  });

  afterEach(() => {
    delete process.env['OPENAI_API_KEY'];
  });

  it('returns structured result from OpenAI API', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Hello from GPT' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 200, completion_tokens: 75 },
    });

    const result = await invokeOpenAIOrchestrator(baseOpts);

    expect(result.content).toBe('Hello from GPT');
    expect(result.inputTokens).toBe(200);
    expect(result.outputTokens).toBe(75);
    expect(result.finishReason).toBe('stop');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('passes model and prompt to the SDK', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    await invokeOpenAIOrchestrator(baseOpts);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test prompt' }],
      }),
    );
  });

  it('throws when no API key and no baseUrl', async () => {
    delete process.env['OPENAI_API_KEY'];

    await expect(invokeOpenAIOrchestrator(baseOpts)).rejects.toThrow('No OpenAI API key found');
  });

  it('uses dummy key for local servers with baseUrl', async () => {
    delete process.env['OPENAI_API_KEY'];

    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'local response' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const result = await invokeOpenAIOrchestrator({
      ...baseOpts,
      model: 'llama3.1',
      baseUrl: 'http://localhost:11434/v1',
    });

    expect(result.content).toBe('local response');
  });

  it('converts 429 errors to QuotaError', async () => {
    const rateLimitErr = Object.assign(new Error('rate_limit_error'), { status: 429 });
    mockCreate.mockRejectedValueOnce(rateLimitErr);

    try {
      await invokeOpenAIOrchestrator(baseOpts);
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as Error).name).toBe('QuotaError');
    }
  });

  it('wraps other API errors with [Totem Error] prefix', async () => {
    mockCreate.mockRejectedValueOnce(new Error('invalid_api_key'));

    await expect(invokeOpenAIOrchestrator(baseOpts)).rejects.toThrow(
      '[Totem Error] OpenAI API call failed',
    );
  });

  it('handles missing usage gracefully (local servers)', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'no usage' }, finish_reason: 'stop' }],
      // No usage field — some local servers omit this
    });

    const result = await invokeOpenAIOrchestrator(baseOpts);

    expect(result.content).toBe('no usage');
    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
  });

  it('handles empty choices array', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 0 },
    });

    const result = await invokeOpenAIOrchestrator(baseOpts);

    expect(result.content).toBe('');
    expect(result.finishReason).toBeUndefined();
  });

  it('handles null message content', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: null }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const result = await invokeOpenAIOrchestrator(baseOpts);
    expect(result.content).toBe('');
  });
});
