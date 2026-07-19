import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Orchestrator as OrchestratorConfig } from '@mmnto/totem';
import { TotemOrchestratorError } from '@mmnto/totem';

import type { OrchestratorInvokeOptions, OrchestratorResult } from './orchestrator.js';
import {
  classifyInvokeFailure,
  CLI_FALLBACK_COMMANDS,
  createOrchestrator,
  detectPackageManager,
  isQuotaError,
  OrchestratorInvokeError,
  parseModelString,
  resolveOrchestrator,
  toOrchestratorInvokeError,
} from './orchestrator.js';

const { mockShellInvoke, mockSpawn } = vi.hoisted(() => ({
  mockShellInvoke: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: mockSpawn,
}));

vi.mock('./shell-orchestrator.js', () => ({
  invokeShellOrchestrator: mockShellInvoke,
}));

// ─── Mock provider modules ──────────────────────────

vi.mock('./gemini-orchestrator.js', () => ({
  invokeGeminiOrchestrator: vi.fn().mockResolvedValue({
    content: 'gemini result',
    inputTokens: 100,
    outputTokens: 50,
    durationMs: 1000,
  }),
}));

vi.mock('./anthropic-orchestrator.js', () => ({
  invokeAnthropicOrchestrator: vi.fn().mockResolvedValue({
    content: 'anthropic result',
    inputTokens: 200,
    outputTokens: 75,
    durationMs: 2000,
  }),
}));

vi.mock('./openai-orchestrator.js', () => ({
  invokeOpenAIOrchestrator: vi.fn().mockResolvedValue({
    content: 'openai result',
    inputTokens: 150,
    outputTokens: 60,
    durationMs: 1500,
  }),
}));

// ─── Tests ──────────────────────────────────────────

describe('createOrchestrator', () => {
  it('returns a function for shell provider', () => {
    const config: OrchestratorConfig = {
      provider: 'shell',
      command: 'echo {file}',
    };
    const invoke = createOrchestrator(config);
    expect(typeof invoke).toBe('function');
  });

  it('returns a function for gemini provider', () => {
    const config: OrchestratorConfig = {
      provider: 'gemini',
      defaultModel: 'gemini-2.5-flash',
    };
    const invoke = createOrchestrator(config);
    expect(typeof invoke).toBe('function');
  });

  it('returns a function for anthropic provider', () => {
    const config: OrchestratorConfig = {
      provider: 'anthropic',
      defaultModel: 'claude-sonnet-4-6',
    };
    const invoke = createOrchestrator(config);
    expect(typeof invoke).toBe('function');
  });

  it('gemini invoker dispatches to gemini-orchestrator module', async () => {
    const config: OrchestratorConfig = { provider: 'gemini' };
    const invoke = createOrchestrator(config);
    const result = await invoke({
      prompt: 'test',
      model: 'gemini-2.5-flash',
      cwd: '.',
      tag: 'Test',
      totemDir: '.totem',
    });
    expect(result.content).toBe('gemini result');
    expect(result.inputTokens).toBe(100);
  });

  it('anthropic invoker dispatches to anthropic-orchestrator module', async () => {
    const config: OrchestratorConfig = { provider: 'anthropic' };
    const invoke = createOrchestrator(config);
    const result = await invoke({
      prompt: 'test',
      model: 'claude-sonnet-4-6',
      cwd: '.',
      tag: 'Test',
      totemDir: '.totem',
    });
    expect(result.content).toBe('anthropic result');
    expect(result.inputTokens).toBe(200);
  });

  it('returns a function for openai provider', () => {
    const config: OrchestratorConfig = {
      provider: 'openai',
      defaultModel: 'gpt-5.4',
    };
    const invoke = createOrchestrator(config);
    expect(typeof invoke).toBe('function');
  });

  it('openai invoker dispatches to openai-orchestrator module', async () => {
    const config: OrchestratorConfig = { provider: 'openai' };
    const invoke = createOrchestrator(config);
    const result = await invoke({
      prompt: 'test',
      model: 'gpt-5.4',
      cwd: '.',
      tag: 'Test',
      totemDir: '.totem',
    });
    expect(result.content).toBe('openai result');
    expect(result.inputTokens).toBe(150);
  });
});

// ─── CLI fallback ───────────────────────────────────

describe('withCliFallback (via createOrchestrator)', () => {
  it('pins Anthropic CLI fallback to prompt bytes on stdin', () => {
    expect(CLI_FALLBACK_COMMANDS['anthropic']).toBe('claude -p --model {model} < {file}');
    expect(CLI_FALLBACK_COMMANDS['anthropic']).not.toMatch(/-p\s+\{file\}/);
  });

  it('gemini SDK success does not trigger fallback', async () => {
    const config: OrchestratorConfig = { provider: 'gemini' };
    const invoke = createOrchestrator(config);
    const result = await invoke({
      prompt: 'test',
      model: 'gemini-2.5-flash',
      cwd: '.',
      tag: 'Test',
      totemDir: '.totem',
    });
    // The mock resolves — no fallback triggered
    expect(result.content).toBe('gemini result');
  });

  it('anthropic SDK success does not trigger fallback', async () => {
    const config: OrchestratorConfig = { provider: 'anthropic' };
    const invoke = createOrchestrator(config);
    const result = await invoke({
      prompt: 'test',
      model: 'claude-sonnet-4-6',
      cwd: '.',
      tag: 'Test',
      totemDir: '.totem',
    });
    expect(result.content).toBe('anthropic result');
  });

  it('preserves the failed SDK attempt before a successful CLI fallback', async () => {
    const { invokeAnthropicOrchestrator } = await import('./anthropic-orchestrator.js');
    vi.mocked(invokeAnthropicOrchestrator).mockRejectedValueOnce(
      new Error('No Anthropic API key found'),
    );
    const availability = new EventEmitter() as EventEmitter & { kill: () => void };
    availability.kill = vi.fn();
    mockSpawn.mockImplementationOnce(() => {
      process.nextTick(() => availability.emit('close', 0));
      return availability;
    });
    mockShellInvoke.mockResolvedValueOnce({
      content: 'fallback result',
      inputTokens: null,
      outputTokens: null,
      durationMs: 20,
      attempts: [
        {
          sequence: 1,
          route: 'cli-fallback',
          provider: 'anthropic',
          model: 'claude-sonnet-5',
          status: 'succeeded',
          durationMs: 20,
        },
      ],
    });

    const invoke = createOrchestrator({ provider: 'anthropic' });
    const result = await invoke({
      prompt: 'test',
      model: 'claude-sonnet-5',
      cwd: '.',
      tag: 'Test',
      totemDir: '.totem',
    });

    expect(mockShellInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'claude -p --model {model} < {file}',
        provider: 'anthropic',
        route: 'cli-fallback',
      }),
    );
    expect(result.attempts).toEqual([
      expect.objectContaining({
        sequence: 1,
        route: 'sdk',
        status: 'failed',
        failureKind: 'auth',
      }),
      expect.objectContaining({
        sequence: 2,
        route: 'cli-fallback',
        status: 'succeeded',
      }),
    ]);
  });

  it('preserves both attempts when the CLI fallback also fails', async () => {
    const { invokeGeminiOrchestrator } = await import('./gemini-orchestrator.js');
    vi.mocked(invokeGeminiOrchestrator).mockRejectedValueOnce(new Error('No Gemini API key found'));
    const availability = new EventEmitter() as EventEmitter & { kill: () => void };
    availability.kill = vi.fn();
    mockSpawn.mockImplementationOnce(() => {
      process.nextTick(() => availability.emit('close', 0));
      return availability;
    });
    const fallbackAttempt = {
      sequence: 1,
      route: 'cli-fallback' as const,
      provider: 'gemini',
      model: 'gemini-3-pro',
      status: 'failed' as const,
      durationMs: 30,
      failureKind: 'timeout' as const,
    };
    mockShellInvoke.mockRejectedValueOnce(
      new OrchestratorInvokeError('fallback timed out', 'timeout', [fallbackAttempt]),
    );

    const invoke = createOrchestrator({ provider: 'gemini' });
    const err = await invoke({
      prompt: 'test',
      model: 'gemini-3-pro',
      cwd: '.',
      tag: 'Test',
      totemDir: '.totem',
    }).catch((cause: unknown) => cause);

    expect(err).toBeInstanceOf(OrchestratorInvokeError);
    expect(err).toMatchObject({ kind: 'timeout' });
    expect((err as OrchestratorInvokeError).attempts).toEqual([
      expect.objectContaining({ sequence: 1, route: 'sdk', status: 'failed' }),
      expect.objectContaining({
        sequence: 2,
        route: 'cli-fallback',
        status: 'failed',
        failureKind: 'timeout',
      }),
    ]);
  });

  it('preserves the structured CLI install recovery contract when fallback is unavailable', async () => {
    const { invokeAnthropicOrchestrator } = await import('./anthropic-orchestrator.js');
    vi.mocked(invokeAnthropicOrchestrator).mockRejectedValueOnce(
      new Error('No Anthropic API key found'),
    );
    let nowMs = 1_000;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    const availability = new EventEmitter() as EventEmitter & { kill: () => void };
    availability.kill = vi.fn();
    mockSpawn.mockImplementationOnce(() => {
      process.nextTick(() => {
        nowMs += 75;
        availability.emit('close', 1);
      });
      return availability;
    });

    const invoke = createOrchestrator({ provider: 'anthropic' });
    const err = await invoke({
      prompt: 'test',
      model: 'claude-sonnet-5',
      cwd: '.',
      tag: 'Test',
      totemDir: '.totem',
    }).catch((cause: unknown) => cause);
    dateNow.mockRestore();

    expect(err).toBeInstanceOf(OrchestratorInvokeError);
    expect(err).toMatchObject({
      code: 'ORCHESTRATOR_UNAVAILABLE',
      kind: 'process-spawn',
      recoveryHint: 'Install the anthropic CLI or its SDK to use this provider.',
      attempts: [
        expect.objectContaining({ sequence: 1, route: 'sdk' }),
        expect.objectContaining({ sequence: 2, route: 'cli-fallback', durationMs: 75 }),
      ],
    });
  });

  it('preserves recovery guidance on non-fallback-eligible errors', async () => {
    // Override the mock to throw a non-eligible error
    const { invokeGeminiOrchestrator } = await import('./gemini-orchestrator.js');
    const sdkErr = Object.assign(new Error('Gemini API call failed: model not found'), {
      recoveryHint: 'Select a Gemini model available to this account.',
    });
    vi.mocked(invokeGeminiOrchestrator).mockRejectedValueOnce(sdkErr);

    const config: OrchestratorConfig = { provider: 'gemini' };
    const invoke = createOrchestrator(config);
    const rejection = invoke({
      prompt: 'test',
      model: 'bad-model',
      cwd: '.',
      tag: 'Test',
      totemDir: '.totem',
    });
    await expect(rejection).rejects.toThrow('model not found');
    await expect(rejection).rejects.toMatchObject({
      name: 'OrchestratorInvokeError',
      kind: 'model',
      cause: sdkErr,
      recoveryHint: 'Select a Gemini model available to this account.',
      attempts: [
        expect.objectContaining({
          sequence: 1,
          route: 'sdk',
          status: 'failed',
          failureKind: 'model',
        }),
      ],
    });
  });
});

describe('classifyInvokeFailure', () => {
  it('uses deterministic timeout and spawn precedence', () => {
    expect(classifyInvokeFailure(new Error('quota exceeded'), { timedOut: true })).toBe('timeout');
    expect(classifyInvokeFailure(new Error('quota exceeded'), { spawnFailed: true })).toBe(
      'process-spawn',
    );
  });

  it('prefers structured provider metadata over generic prose', () => {
    expect(classifyInvokeFailure(Object.assign(new Error('request failed'), { status: 429 }))).toBe(
      'quota',
    );
    expect(classifyInvokeFailure(Object.assign(new Error('request failed'), { status: 401 }))).toBe(
      'auth',
    );
    expect(
      classifyInvokeFailure(
        Object.assign(new Error('request failed'), { code: 'model_not_found' }),
      ),
    ).toBe('model');
  });

  it('prefers structured auth/model metadata over conflicting quota prose', () => {
    expect(
      classifyInvokeFailure(Object.assign(new Error('quota exhausted'), { status: 401 })),
    ).toBe('auth');
    expect(
      classifyInvokeFailure(
        Object.assign(new Error('rate limit exceeded'), { code: 'model_not_found' }),
      ),
    ).toBe('model');
    expect(
      classifyInvokeFailure(Object.assign(new Error('authentication failed'), { status: 429 })),
    ).toBe('quota');
  });

  it('reads structured provider metadata through wrapped Error causes', () => {
    const providerErr = Object.assign(new Error('provider rejected request'), {
      status: 401,
      code: 'authentication_error',
    });
    const wrapped = new TotemOrchestratorError(
      'outer message mentions quota',
      'keep the provider-specific recovery',
      providerErr,
    );

    expect(classifyInvokeFailure(wrapped)).toBe('auth');
    const normalized = toOrchestratorInvokeError({
      err: wrapped,
      provider: 'openai',
      model: 'gpt-5',
      route: 'sdk',
      durationMs: 12,
    });
    expect(normalized).toBeInstanceOf(TotemOrchestratorError);
    expect(normalized.cause).toBe(wrapped);
    expect(normalized.recoveryHint).toBe('keep the provider-specific recovery');
    expect(normalized.attempts[0]).toMatchObject({
      failureKind: 'auth',
      providerStatus: 401,
      providerCode: 'authentication_error',
      durationMs: 12,
    });
  });

  it('bounds cause traversal and terminates safely on cause cycles', () => {
    const first = new Error('first');
    const second = Object.assign(new Error('second'), { code: 'model_not_found', cause: first });
    Object.assign(first, { cause: second });
    expect(classifyInvokeFailure(first)).toBe('model');

    let beyondDepth: Error = Object.assign(new Error('provider'), { status: 429 });
    for (let index = 0; index < 8; index++) {
      beyondDepth = new Error(`wrapper-${index}`, { cause: beyondDepth });
    }
    expect(classifyInvokeFailure(beyondDepth)).toBe('unknown');
  });

  it('distinguishes process exit and preserves unknown', () => {
    expect(classifyInvokeFailure(new Error('failed'), { exitCode: 2, signal: null })).toBe(
      'process-exit',
    );
    expect(classifyInvokeFailure(new Error('unclassified provider response'))).toBe('unknown');
  });

  it('keeps quota name compatibility on the structured error', () => {
    const err = new OrchestratorInvokeError('provider rejected the request', 'quota', []);
    expect(err).toBeInstanceOf(OrchestratorInvokeError);
    expect(err.name).toBe('QuotaError');
    expect(isQuotaError(err)).toBe(true);
    expect(err.code).toBe('ORCHESTRATOR_UNAVAILABLE');
    expect(err.recoveryHint).toContain('fallbackModel');
  });

  it('normalizes duplicate Totem prefixes and bounds recovery hints', () => {
    const err = new OrchestratorInvokeError('[Totem Error] [Totem Error] failed', 'unknown', [], {
      recoveryHint: 'x'.repeat(2_000),
    });
    expect(err.message).toBe('[Totem Error] failed');
    expect(Buffer.byteLength(err.recoveryHint, 'utf8')).toBeLessThanOrEqual(1_024);
  });
});

// ─── detectPackageManager ───────────────────────────

describe('detectPackageManager', () => {
  const originalUa = process.env['npm_config_user_agent'];

  afterEach(() => {
    if (originalUa !== undefined) {
      process.env['npm_config_user_agent'] = originalUa;
    } else {
      delete process.env['npm_config_user_agent'];
    }
  });

  it('detects pnpm', () => {
    process.env['npm_config_user_agent'] = 'pnpm/9.15.0 npm/? node/v22.0.0';
    expect(detectPackageManager()).toBe('pnpm');
  });

  it('detects yarn', () => {
    process.env['npm_config_user_agent'] = 'yarn/4.0.0 npm/? node/v22.0.0';
    expect(detectPackageManager()).toBe('yarn');
  });

  it('detects bun', () => {
    process.env['npm_config_user_agent'] = 'bun/1.0.0';
    expect(detectPackageManager()).toBe('bun');
  });

  it('defaults to npm when env var is missing', () => {
    delete process.env['npm_config_user_agent'];
    expect(detectPackageManager()).toBe('npm');
  });

  it('defaults to npm for unknown user agent', () => {
    process.env['npm_config_user_agent'] = 'npm/10.0.0 node/v22.0.0';
    expect(detectPackageManager()).toBe('npm');
  });
});

// ─── isQuotaError ───────────────────────────────────

describe('isQuotaError', () => {
  it('detects 429 status errors', () => {
    const err = Object.assign(new Error('rate limit'), { status: 429 });
    expect(isQuotaError(err)).toBe(true);
  });

  it('detects quota keyword in message', () => {
    expect(isQuotaError(new Error('quota exceeded'))).toBe(true);
  });

  it('detects rate limit keyword in message', () => {
    expect(isQuotaError(new Error('rate limit reached'))).toBe(true);
  });

  it('detects too many requests keyword', () => {
    expect(isQuotaError(new Error('Too Many Requests'))).toBe(true);
  });

  it('returns false for non-quota errors', () => {
    expect(isQuotaError(new Error('Model not found'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isQuotaError('some string')).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });
});

// ─── resolveOrchestrator (#248) ─────────────────────

describe('resolveOrchestrator', () => {
  const mockInvoke = vi.fn().mockResolvedValue({
    content: 'mock result',
    inputTokens: 100,
    outputTokens: 50,
    durationMs: 500,
  });

  it('reuses baseInvoke for same-provider resolution', () => {
    const result = resolveOrchestrator('gemini-3-flash-preview', 'gemini', mockInvoke);
    expect(result.invoke).toBe(mockInvoke);
    expect(result.parsed).toEqual({ provider: 'gemini', model: 'gemini-3-flash-preview' });
    expect(result.qualifiedModel).toBe('gemini-3-flash-preview');
  });

  it('creates new invoker for cross-provider resolution', () => {
    const result = resolveOrchestrator('anthropic:claude-sonnet-4-6', 'gemini', mockInvoke);
    expect(result.invoke).not.toBe(mockInvoke);
    expect(result.parsed).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(result.qualifiedModel).toBe('anthropic:claude-sonnet-4-6');
  });

  it('throws on empty model string (provider:)', () => {
    expect(() => resolveOrchestrator('anthropic:', 'gemini', mockInvoke)).toThrow(
      'must not be empty or start with a hyphen',
    );
  });

  it('throws on model starting with hyphen', () => {
    expect(() => resolveOrchestrator('anthropic:-bad', 'gemini', mockInvoke)).toThrow(
      'must not be empty or start with a hyphen',
    );
  });

  it('throws when cross-routing to shell from API provider', () => {
    expect(() => resolveOrchestrator('shell:my-model', 'gemini', mockInvoke)).toThrow(
      "Cannot route to 'shell' provider",
    );
  });

  it('allows shell-to-shell routing', () => {
    const result = resolveOrchestrator('shell:my-model', 'shell', mockInvoke);
    expect(result.invoke).toBe(mockInvoke);
    expect(result.parsed).toEqual({ provider: 'shell', model: 'my-model' });
  });

  it('preserves provider:model as qualifiedModel for cross-route', () => {
    const result = resolveOrchestrator('gemini:gemini-3.1-pro-preview', 'anthropic', mockInvoke);
    expect(result.qualifiedModel).toBe('gemini:gemini-3.1-pro-preview');
  });

  it('rejects model names with shell metacharacters', () => {
    expect(() => resolveOrchestrator('$(touch /tmp/pwned)', 'shell', mockInvoke)).toThrow(
      'Invalid model name',
    );
    expect(() => resolveOrchestrator('model;rm -rf /', 'shell', mockInvoke)).toThrow(
      'Invalid model name',
    );
  });
});

// ─── Caching foundation (mmnto/totem#1291 Phase 1) ─────────────
//
// Pure type/shape assertions: prove that the new optional fields on
// OrchestratorInvokeOptions and OrchestratorResult are backward-compatible.
// Phase 2 will add behavior tests against the actual Anthropic provider.

describe('OrchestratorInvokeOptions caching foundation', { timeout: 15000 }, () => {
  it('accepts the legacy minimal shape (no systemPrompt, no caching fields)', () => {
    const opts: OrchestratorInvokeOptions = {
      prompt: 'legacy call',
      model: 'claude-sonnet-4-6',
      cwd: '.',
      tag: 'Test',
      totemDir: '.totem',
    };
    expect(opts.prompt).toBe('legacy call');
    expect(opts.systemPrompt).toBeUndefined();
    expect(opts.enableContextCaching).toBeUndefined();
    expect(opts.cacheTTL).toBeUndefined();
  });

  it('accepts the full caching-enabled shape', () => {
    const opts: OrchestratorInvokeOptions = {
      prompt: 'ephemeral user query',
      systemPrompt: 'persistent ast-grep manual + few-shot',
      model: 'claude-sonnet-4-6',
      cwd: '.',
      tag: 'Compile',
      totemDir: '.totem',
      enableContextCaching: true,
      cacheTTL: 300,
    };
    expect(opts.systemPrompt).toBe('persistent ast-grep manual + few-shot');
    expect(opts.enableContextCaching).toBe(true);
    expect(opts.cacheTTL).toBe(300);
  });

  it('accepts a 1-hour extended cacheTTL', () => {
    const opts: OrchestratorInvokeOptions = {
      prompt: 'q',
      systemPrompt: 's',
      model: 'claude-sonnet-4-6',
      cwd: '.',
      tag: 'T',
      totemDir: '.totem',
      enableContextCaching: true,
      cacheTTL: 3600,
    };
    expect(opts.cacheTTL).toBe(3600);
  });

  it('caching options flow through createOrchestrator dispatch without breaking the call', async () => {
    // Sanity check: passing the new caching fields through createOrchestrator's
    // resulting invoker must not break the call shape. The mocks at the top of
    // this file resolve the same OrchestratorResult shape regardless of whether
    // caching is opted into — the actual SDK-level cache wiring lives in the
    // anthropic-orchestrator.test.ts behavior tests.
    const config: OrchestratorConfig = { provider: 'anthropic' };
    const invoke = createOrchestrator(config);
    const result = await invoke({
      prompt: 'ephemeral',
      systemPrompt: 'persistent',
      model: 'claude-sonnet-4-6',
      cwd: '.',
      tag: 'Test',
      totemDir: '.totem',
      enableContextCaching: true,
      cacheTTL: 300,
    });
    expect(result.content).toBe('anthropic result');
  });
});

describe('OrchestratorResult caching foundation', { timeout: 15000 }, () => {
  it('accepts the legacy shape with no cache fields', () => {
    const result: OrchestratorResult = {
      content: 'ok',
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 1000,
    };
    expect(result.cacheReadInputTokens).toBeUndefined();
    expect(result.cacheCreationInputTokens).toBeUndefined();
  });

  it('accepts a result with cache hit metrics', () => {
    const result: OrchestratorResult = {
      content: 'ok',
      inputTokens: 50_000,
      outputTokens: 200,
      durationMs: 800,
      cacheReadInputTokens: 47_231,
      cacheCreationInputTokens: 0,
    };
    expect(result.cacheReadInputTokens).toBe(47_231);
    expect(result.cacheCreationInputTokens).toBe(0);
  });

  it('accepts a result with cache write metrics (first call)', () => {
    const result: OrchestratorResult = {
      content: 'ok',
      inputTokens: 50_000,
      outputTokens: 200,
      durationMs: 2_400,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 47_231,
    };
    expect(result.cacheCreationInputTokens).toBe(47_231);
  });

  it('accepts null cache metrics (provider does not support caching)', () => {
    const result: OrchestratorResult = {
      content: 'ok',
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 500,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
    };
    expect(result.cacheReadInputTokens).toBeNull();
    expect(result.cacheCreationInputTokens).toBeNull();
  });
});

// ─── parseModelString (#243) ────────────────────────

describe('parseModelString', () => {
  it('parses anthropic:model into provider and model', () => {
    expect(parseModelString('anthropic:claude-sonnet-4-6', 'gemini')).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    });
  });

  it('parses gemini:model into provider and model', () => {
    expect(parseModelString('gemini:gemini-3.1-pro-preview', 'anthropic')).toEqual({
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
    });
  });

  it('parses openai:model into provider and model', () => {
    expect(parseModelString('openai:gpt-5.4', 'gemini')).toEqual({
      provider: 'openai',
      model: 'gpt-5.4',
    });
  });

  it('parses shell:model into provider and model', () => {
    expect(parseModelString('shell:my-model', 'gemini')).toEqual({
      provider: 'shell',
      model: 'my-model',
    });
  });

  it('returns default provider for plain model string', () => {
    expect(parseModelString('gemini-3-flash-preview', 'gemini')).toEqual({
      provider: 'gemini',
      model: 'gemini-3-flash-preview',
    });
  });

  it('returns default provider for unknown prefix (not a known provider)', () => {
    expect(parseModelString('unknown:my-model:v1', 'gemini')).toEqual({
      provider: 'gemini',
      model: 'unknown:my-model:v1',
    });
  });

  it('returns default provider for org/namespace:model patterns', () => {
    expect(parseModelString('myorg/namespace:model-v1', 'anthropic')).toEqual({
      provider: 'anthropic',
      model: 'myorg/namespace:model-v1',
    });
  });

  it('parses empty model after colon (caller should validate)', () => {
    expect(parseModelString('anthropic:', 'gemini')).toEqual({
      provider: 'anthropic',
      model: '',
    });
  });

  it('does not split on leading colon', () => {
    expect(parseModelString(':some-model', 'gemini')).toEqual({
      provider: 'gemini',
      model: ':some-model',
    });
  });
});
