import type { Orchestrator as OrchestratorConfig } from '@mmnto/totem';

import { invokeShellOrchestrator } from './shell-orchestrator.js';

// ─── Shared types ────────────────────────────────────

export interface OrchestratorResult {
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
  finishReason?: string;
}

export interface OrchestratorInvokeOptions {
  prompt: string;
  model: string;
  cwd: string;
  tag: string;
  totemDir: string;
}

/** A provider-bound function that invokes an LLM and returns the result. */
export type InvokeOrchestrator = (
  options: OrchestratorInvokeOptions,
) => Promise<OrchestratorResult>;

// ─── Factory ─────────────────────────────────────────

/**
 * Create an orchestrator invoker bound to the given provider config.
 * Mirrors the `createEmbedder()` pattern from `packages/core/src/embedders/`.
 */
export function createOrchestrator(config: OrchestratorConfig): InvokeOrchestrator {
  switch (config.provider) {
    case 'shell':
      return (opts) => invokeShellOrchestrator({ ...opts, command: config.command });
    case 'gemini':
      return async (opts) => {
        const { invokeGeminiOrchestrator } = await import('./gemini-orchestrator.js');
        return invokeGeminiOrchestrator(opts);
      };
    case 'anthropic':
      return async (opts) => {
        const { invokeAnthropicOrchestrator } = await import('./anthropic-orchestrator.js');
        return invokeAnthropicOrchestrator(opts);
      };
  }
}
