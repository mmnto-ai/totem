import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Orchestrator as OrchestratorConfig } from '@mmnto/totem';

import {
  createOrchestrator,
  detectPackageManager,
  isQuotaError,
  parseModelString,
  resolveOrchestrator,
} from './orchestrator.js';

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
      defaultModel: 'claude-sonnet-4-5-20250514',
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
      model: 'claude-sonnet-4-5-20250514',
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
      defaultModel: 'gpt-4o',
    };
    const invoke = createOrchestrator(config);
    expect(typeof invoke).toBe('function');
  });

  it('openai invoker dispatches to openai-orchestrator module', async () => {
    const config: OrchestratorConfig = { provider: 'openai' };
    const invoke = createOrchestrator(config);
    const result = await invoke({
      prompt: 'test',
      model: 'gpt-4o',
      cwd: '.',
      tag: 'Test',
      totemDir: '.totem',
    });
    expect(result.content).toBe('openai result');
    expect(result.inputTokens).toBe(150);
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
    const result = resolveOrchestrator('anthropic:claude-sonnet-4-20250514', 'gemini', mockInvoke);
    expect(result.invoke).not.toBe(mockInvoke);
    expect(result.parsed).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
    expect(result.qualifiedModel).toBe('anthropic:claude-sonnet-4-20250514');
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

// ─── parseModelString (#243) ────────────────────────

describe('parseModelString', () => {
  it('parses anthropic:model into provider and model', () => {
    expect(parseModelString('anthropic:claude-sonnet-4-20250514', 'gemini')).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    });
  });

  it('parses gemini:model into provider and model', () => {
    expect(parseModelString('gemini:gemini-3.1-pro-preview', 'anthropic')).toEqual({
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
    });
  });

  it('parses openai:model into provider and model', () => {
    expect(parseModelString('openai:gpt-4o', 'gemini')).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
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
