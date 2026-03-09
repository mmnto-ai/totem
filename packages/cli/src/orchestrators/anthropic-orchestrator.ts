import type { OrchestratorInvokeOptions, OrchestratorResult } from './orchestrator.js';

/**
 * Invoke the Anthropic API via the `@anthropic-ai/sdk`.
 * Requires: `pnpm add -D @anthropic-ai/sdk`
 *
 * @see https://github.com/mmnto-ai/totem/issues/232
 */
export async function invokeAnthropicOrchestrator(
  _opts: OrchestratorInvokeOptions,
): Promise<OrchestratorResult> {
  // TODO: Implement in #232
  throw new Error(
    '[Totem Error] Anthropic API orchestrator is not yet implemented.\n' +
      "Use provider: 'shell' in your orchestrator config, or track progress at https://github.com/mmnto-ai/totem/issues/232",
  );
}
