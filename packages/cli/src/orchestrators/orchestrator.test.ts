import { describe, expect, it } from 'vitest';

import type { Orchestrator as OrchestratorConfig } from '@mmnto/totem';

import { createOrchestrator } from './orchestrator.js';

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

  it('gemini invoker throws not-yet-implemented error', async () => {
    const config: OrchestratorConfig = {
      provider: 'gemini',
    };
    const invoke = createOrchestrator(config);
    await expect(
      invoke({
        prompt: 'test',
        model: 'gemini-2.5-flash',
        cwd: '.',
        tag: 'Test',
        totemDir: '.totem',
      }),
    ).rejects.toThrow('not yet implemented');
  });

  it('anthropic invoker throws not-yet-implemented error', async () => {
    const config: OrchestratorConfig = {
      provider: 'anthropic',
    };
    const invoke = createOrchestrator(config);
    await expect(
      invoke({
        prompt: 'test',
        model: 'claude-sonnet-4-5-20250514',
        cwd: '.',
        tag: 'Test',
        totemDir: '.totem',
      }),
    ).rejects.toThrow('not yet implemented');
  });
});
