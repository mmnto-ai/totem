import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invokeAnthropicOrchestrator } from './anthropic-orchestrator.js';

// ─── Mock SDK ───────────────────────────────────────

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

vi.mock('../ui.js', () => ({
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(), dim: vi.fn() },
}));

// ─── Tests ──────────────────────────────────────────

describe('invokeAnthropicOrchestrator', () => {
  const baseOpts = {
    prompt: 'test prompt',
    model: 'claude-sonnet-4-6',
    cwd: '.',
    tag: 'Test',
    totemDir: '.totem',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
  });

  afterEach(() => {
    delete process.env['ANTHROPIC_API_KEY'];
  });

  it('returns structured result from Anthropic API', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Hello from Claude' }],
      usage: { input_tokens: 200, output_tokens: 75 },
      stop_reason: 'end_turn',
    });

    const result = await invokeAnthropicOrchestrator(baseOpts);

    expect(result.content).toBe('Hello from Claude');
    expect(result.inputTokens).toBe(200);
    expect(result.outputTokens).toBe(75);
    expect(result.finishReason).toBe('end_turn');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('passes model and prompt to the SDK', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: 'end_turn',
    });

    await invokeAnthropicOrchestrator(baseOpts);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'test prompt' }],
      }),
    );
  });

  it('throws when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env['ANTHROPIC_API_KEY'];

    await expect(invokeAnthropicOrchestrator(baseOpts)).rejects.toThrow(
      'No Anthropic API key found',
    );
  });

  it('converts 429 errors to QuotaError', async () => {
    const rateLimitErr = Object.assign(new Error('rate_limit_error'), { status: 429 });
    mockCreate.mockRejectedValueOnce(rateLimitErr);

    try {
      await invokeAnthropicOrchestrator(baseOpts);
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as Error).name).toBe('QuotaError');
    }
  });

  it('wraps other API errors with [Totem Error] prefix', async () => {
    mockCreate.mockRejectedValueOnce(new Error('invalid_api_key'));

    await expect(invokeAnthropicOrchestrator(baseOpts)).rejects.toThrow(
      '[Totem Error] Anthropic API call failed',
    );
  });

  it('joins multiple text blocks', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'Part one' },
        { type: 'text', text: 'Part two' },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
      stop_reason: 'end_turn',
    });

    const result = await invokeAnthropicOrchestrator(baseOpts);
    expect(result.content).toBe('Part one\nPart two');
  });

  it('skips non-text content blocks', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'x', name: 'foo', input: {} },
        { type: 'text', text: 'Only text' },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
      stop_reason: 'end_turn',
    });

    const result = await invokeAnthropicOrchestrator(baseOpts);
    expect(result.content).toBe('Only text');
  });

  it('handles null stop_reason', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'response' }],
      usage: { input_tokens: 100, output_tokens: 50 },
      stop_reason: null,
    });

    const result = await invokeAnthropicOrchestrator(baseOpts);
    expect(result.finishReason).toBeUndefined();
  });
});
