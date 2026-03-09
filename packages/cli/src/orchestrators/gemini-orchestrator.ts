import type { OrchestratorInvokeOptions, OrchestratorResult } from './orchestrator.js';

/**
 * Invoke the Gemini API via the `@google/genai` SDK.
 * Requires: `pnpm add -D @google/genai`
 *
 * @see https://github.com/mmnto-ai/totem/issues/231
 */
export async function invokeGeminiOrchestrator(
  _opts: OrchestratorInvokeOptions,
): Promise<OrchestratorResult> {
  // TODO: Implement in #231
  throw new Error(
    '[Totem Error] Gemini API orchestrator is not yet implemented.\n' +
      "Use provider: 'shell' in your orchestrator config, or track progress at https://github.com/mmnto-ai/totem/issues/231",
  );
}
