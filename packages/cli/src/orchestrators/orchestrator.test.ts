import { describe, expect, it, vi } from 'vitest';

import type { Orchestrator as OrchestratorConfig } from '@mmnto/totem';

import { createOrchestrator } from './orchestrator.js';

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
});
