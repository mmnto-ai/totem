import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invokeGeminiOrchestrator } from './gemini-orchestrator.js';

// ─── Mock SDK ───────────────────────────────────────

const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

vi.mock('../ui.js', () => ({
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(), dim: vi.fn() },
}));

// ─── Tests ──────────────────────────────────────────

describe('invokeGeminiOrchestrator', () => {
  const baseOpts = {
    prompt: 'test prompt',
    model: 'gemini-2.5-flash',
    cwd: '.',
    tag: 'Test',
    totemDir: '.totem',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['GEMINI_API_KEY'] = 'test-key';
  });

  afterEach(() => {
    delete process.env['GEMINI_API_KEY'];
    delete process.env['GOOGLE_API_KEY'];
  });

  it('returns structured result from Gemini API', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: 'Hello from Gemini',
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      candidates: [{ finishReason: 'STOP' }],
    });

    const result = await invokeGeminiOrchestrator(baseOpts);

    expect(result.content).toBe('Hello from Gemini');
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
    expect(result.finishReason).toBe('STOP');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('passes model and prompt to the SDK', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: 'ok',
      usageMetadata: {},
      candidates: [],
    });

    await invokeGeminiOrchestrator(baseOpts);

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.5-flash',
        contents: 'test prompt',
      }),
    );
  });

  it('falls back to GOOGLE_API_KEY when GEMINI_API_KEY is not set', async () => {
    delete process.env['GEMINI_API_KEY'];
    process.env['GOOGLE_API_KEY'] = 'google-key';

    mockGenerateContent.mockResolvedValueOnce({
      text: 'ok',
      usageMetadata: {},
      candidates: [],
    });

    // Should not throw — GOOGLE_API_KEY is accepted
    await invokeGeminiOrchestrator(baseOpts);
  });

  it('throws when no API key is set', async () => {
    delete process.env['GEMINI_API_KEY'];
    delete process.env['GOOGLE_API_KEY'];

    await expect(invokeGeminiOrchestrator(baseOpts)).rejects.toThrow('No Gemini API key found');
  });

  it('converts 429 status errors to QuotaError', async () => {
    const rateLimitErr = Object.assign(new Error('Resource exhausted'), { status: 429 });
    mockGenerateContent.mockRejectedValueOnce(rateLimitErr);

    try {
      await invokeGeminiOrchestrator(baseOpts);
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as Error).name).toBe('QuotaError');
    }
  });

  it('converts quota keyword errors to QuotaError', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('quota exceeded for model'));

    try {
      await invokeGeminiOrchestrator(baseOpts);
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as Error).name).toBe('QuotaError');
    }
  });

  it('wraps other API errors with [Totem Error] prefix', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('Model not found'));

    await expect(invokeGeminiOrchestrator(baseOpts)).rejects.toThrow(
      '[Totem Error] Gemini API call failed',
    );
  });

  it('handles missing usageMetadata gracefully', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: 'response',
      candidates: [],
    });

    const result = await invokeGeminiOrchestrator(baseOpts);
    expect(result.content).toBe('response');
    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
    expect(result.finishReason).toBeUndefined();
  });

  it('handles undefined text as empty string', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: undefined,
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0 },
      candidates: [{ finishReason: 'SAFETY' }],
    });

    const result = await invokeGeminiOrchestrator(baseOpts);
    expect(result.content).toBe('');
    expect(result.finishReason).toBe('SAFETY');
  });

  // ─── systemPrompt threading (mmnto/totem#1291 Phase 3 cascade fix) ──

  describe('systemPrompt threading', { timeout: 15000 }, () => {
    const happyResponse = () => ({
      text: 'ok',
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      candidates: [{ finishReason: 'STOP' }],
    });

    it('passes systemPrompt as config.systemInstruction when provided', async () => {
      mockGenerateContent.mockResolvedValueOnce(happyResponse());

      await invokeGeminiOrchestrator({
        ...baseOpts,
        systemPrompt: 'COMPILER_SYSTEM_PROMPT',
      });

      const call = mockGenerateContent.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call).toBeDefined();
      const config = call['config'] as Record<string, unknown>;
      expect(config['systemInstruction']).toBe('COMPILER_SYSTEM_PROMPT');
      // contents (the user prompt) is unchanged
      expect(call['contents']).toBe('test prompt');
    });

    it('omits systemInstruction from config when systemPrompt is undefined (backward compat)', async () => {
      mockGenerateContent.mockResolvedValueOnce(happyResponse());

      await invokeGeminiOrchestrator(baseOpts);

      const call = mockGenerateContent.mock.calls[0]?.[0] as Record<string, unknown>;
      const config = call['config'] as Record<string, unknown>;
      expect(config['systemInstruction']).toBeUndefined();
    });

    it('treats an empty systemPrompt the same as undefined (omits systemInstruction)', async () => {
      // GCA round 2 SAFETY INVARIANT: Gemini may reject empty
      // systemInstruction. Match the parallel checks in
      // anthropic/openai/ollama by treating empty/undefined the same.
      mockGenerateContent.mockResolvedValueOnce(happyResponse());
      await invokeGeminiOrchestrator({ ...baseOpts, systemPrompt: '' });
      const call = mockGenerateContent.mock.calls[0]?.[0] as Record<string, unknown>;
      const config = call['config'] as Record<string, unknown>;
      expect(config['systemInstruction']).toBeUndefined();
    });
  });
});
