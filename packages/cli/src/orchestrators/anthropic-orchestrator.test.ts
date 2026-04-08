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

  // ─── Caching (mmnto/totem#1291 Phase 2) ──────────────

  describe('prompt caching', { timeout: 15000 }, () => {
    const happyResponse = (extraUsage: Record<string, unknown> = {}) => ({
      content: [{ type: 'text', text: 'cached response' }],
      usage: { input_tokens: 100, output_tokens: 50, ...extraUsage },
      stop_reason: 'end_turn',
    });

    it('omits the system field entirely when systemPrompt is undefined (today shape)', async () => {
      mockCreate.mockResolvedValueOnce(happyResponse());

      await invokeAnthropicOrchestrator(baseOpts);

      const call = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call).toBeDefined();
      expect(call['system']).toBeUndefined();
      expect(call['messages']).toEqual([{ role: 'user', content: 'test prompt' }]);
    });

    it('passes systemPrompt as a plain string when caching is disabled', async () => {
      mockCreate.mockResolvedValueOnce(happyResponse());

      await invokeAnthropicOrchestrator({
        ...baseOpts,
        systemPrompt: 'persistent ast-grep manual',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'persistent ast-grep manual',
          messages: [{ role: 'user', content: 'test prompt' }],
        }),
      );
    });

    // Cascade-fix coverage: Phase 3 made systemPrompt always set on the
    // compile path, so non-Anthropic providers needed parallel updates to
    // consume it for correctness (not just for caching). The corresponding
    // tests for Gemini / OpenAI / Ollama / Shell live in their respective
    // *.test.ts files. This Anthropic test asserts that the SDK call shape
    // is unchanged when systemPrompt comes through with caching off — which
    // is the parity contract those other tests must mirror.
    it('threads systemPrompt to the SDK even when caching is implicitly off', async () => {
      mockCreate.mockResolvedValueOnce(happyResponse());
      await invokeAnthropicOrchestrator({
        ...baseOpts,
        systemPrompt: 'COMPILER_SYSTEM_PROMPT_BYTES',
        // enableContextCaching not set → defaults to off → system is plain string
      });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ system: 'COMPILER_SYSTEM_PROMPT_BYTES' }),
      );
    });

    it('treats an empty systemPrompt the same as undefined (omits system field)', async () => {
      // GCA round 2 SAFETY INVARIANT: Anthropic rejects empty `system`
      // strings with a 400 error. Match the existing shell-orchestrator
      // pattern by treating empty/undefined the same.
      mockCreate.mockResolvedValueOnce(happyResponse());
      await invokeAnthropicOrchestrator({
        ...baseOpts,
        systemPrompt: '',
        enableContextCaching: true,
      });
      const call = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call['system']).toBeUndefined();
    });

    it('emits cache_control: ephemeral when caching is enabled (5-minute default)', async () => {
      mockCreate.mockResolvedValueOnce(happyResponse());

      await invokeAnthropicOrchestrator({
        ...baseOpts,
        systemPrompt: 'persistent ast-grep manual',
        enableContextCaching: true,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: [
            {
              type: 'text',
              text: 'persistent ast-grep manual',
              cache_control: { type: 'ephemeral' },
            },
          ],
        }),
      );
    });

    it('emits ttl: 1h when cacheTTL is 3600 (extended cache)', async () => {
      mockCreate.mockResolvedValueOnce(happyResponse());

      await invokeAnthropicOrchestrator({
        ...baseOpts,
        systemPrompt: 'persistent ast-grep manual',
        enableContextCaching: true,
        cacheTTL: 3600,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: [
            {
              type: 'text',
              text: 'persistent ast-grep manual',
              cache_control: { type: 'ephemeral', ttl: '1h' },
            },
          ],
        }),
      );
    });

    it('omits ttl when cacheTTL is the explicit 5-minute value (300)', async () => {
      mockCreate.mockResolvedValueOnce(happyResponse());

      await invokeAnthropicOrchestrator({
        ...baseOpts,
        systemPrompt: 'persistent ast-grep manual',
        enableContextCaching: true,
        cacheTTL: 300,
      });

      // 5m is the API default — explicit 300 should produce no ttl field.
      const call = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
      const system = call['system'] as Array<{ cache_control: Record<string, unknown> }>;
      expect(system[0]?.cache_control).toEqual({ type: 'ephemeral' });
      expect(system[0]?.cache_control?.['ttl']).toBeUndefined();
    });

    it('falls back to 5-minute ephemeral when cacheTTL is below 3600', async () => {
      mockCreate.mockResolvedValueOnce(happyResponse());

      await invokeAnthropicOrchestrator({
        ...baseOpts,
        systemPrompt: 'persistent context',
        enableContextCaching: true,
        cacheTTL: 600, // unsupported by Anthropic — should fall through to 5m
      });

      const call = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
      const system = call['system'] as Array<{ cache_control: Record<string, unknown> }>;
      expect(system[0]?.cache_control).toEqual({ type: 'ephemeral' });
    });

    it('still uses string-form system when systemPrompt is set but caching is explicitly false', async () => {
      mockCreate.mockResolvedValueOnce(happyResponse());

      await invokeAnthropicOrchestrator({
        ...baseOpts,
        systemPrompt: 'persistent context',
        enableContextCaching: false,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'persistent context',
        }),
      );
    });

    it('surfaces cache_read_input_tokens from response.usage', async () => {
      mockCreate.mockResolvedValueOnce(
        happyResponse({ cache_read_input_tokens: 47_231, cache_creation_input_tokens: 0 }),
      );

      const result = await invokeAnthropicOrchestrator({
        ...baseOpts,
        systemPrompt: 'cached',
        enableContextCaching: true,
      });

      expect(result.cacheReadInputTokens).toBe(47_231);
      expect(result.cacheCreationInputTokens).toBe(0);
    });

    it('surfaces cache_creation_input_tokens on first call (cache miss → write)', async () => {
      mockCreate.mockResolvedValueOnce(
        happyResponse({ cache_read_input_tokens: 0, cache_creation_input_tokens: 47_231 }),
      );

      const result = await invokeAnthropicOrchestrator({
        ...baseOpts,
        systemPrompt: 'cached',
        enableContextCaching: true,
      });

      expect(result.cacheCreationInputTokens).toBe(47_231);
      expect(result.cacheReadInputTokens).toBe(0);
    });

    it('returns null cache fields when usage object lacks them (no caching requested)', async () => {
      mockCreate.mockResolvedValueOnce(happyResponse());

      const result = await invokeAnthropicOrchestrator(baseOpts);

      expect(result.cacheReadInputTokens).toBeNull();
      expect(result.cacheCreationInputTokens).toBeNull();
    });

    it('returns null cache fields when SDK returns explicit null values', async () => {
      mockCreate.mockResolvedValueOnce(
        happyResponse({ cache_read_input_tokens: null, cache_creation_input_tokens: null }),
      );

      const result = await invokeAnthropicOrchestrator(baseOpts);

      expect(result.cacheReadInputTokens).toBeNull();
      expect(result.cacheCreationInputTokens).toBeNull();
    });

    it('preserves inputTokens and outputTokens alongside cache fields', async () => {
      mockCreate.mockResolvedValueOnce(
        happyResponse({ cache_read_input_tokens: 47_000, cache_creation_input_tokens: 0 }),
      );

      const result = await invokeAnthropicOrchestrator({
        ...baseOpts,
        systemPrompt: 'cached',
        enableContextCaching: true,
      });

      // input_tokens (100) is the *additional* uncached + ephemeral fresh tokens
      // for THIS call. cache_read_input_tokens (47k) is what was served from
      // cache. The two are distinct counts and both must be observable.
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.cacheReadInputTokens).toBe(47_000);
    });
  });
});
