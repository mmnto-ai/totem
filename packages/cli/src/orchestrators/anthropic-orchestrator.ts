import { TotemConfigError, TotemOrchestratorError } from '@mmnto/totem';

import { log } from '../ui.js';
import type { OrchestratorInvokeOptions, OrchestratorResult } from './orchestrator.js';
import { detectPackageManager, isQuotaError } from './orchestrator.js';

// ─── Constants ───────────────────────────────────────

const DEFAULT_MAX_TOKENS = 8_192;

/** Model-aware max output tokens — prevents API errors on smaller models. */
function getMaxTokens(model: string): number {
  if (model.includes('haiku')) return 4_096;
  if (model.includes('sonnet')) return DEFAULT_MAX_TOKENS;
  if (model.includes('opus')) return 16_384;
  return DEFAULT_MAX_TOKENS;
}

// ─── SDK loader (BYOSD) ─────────────────────────────

async function importAnthropicSdk() {
  try {
    return (await import('@anthropic-ai/sdk')).default;
  } catch {
    throw new TotemConfigError(
      'Anthropic SDK (@anthropic-ai/sdk) is not installed.',
      `Install it with: ${detectPackageManager()} add @anthropic-ai/sdk`,
      'CONFIG_MISSING',
    );
  }
}

// ─── Anthropic API orchestrator ──────────────────────

/**
 * Invoke the Anthropic API via the `@anthropic-ai/sdk`.
 * Requires: `pnpm add @anthropic-ai/sdk` and `ANTHROPIC_API_KEY` env var.
 *
 * @see https://github.com/mmnto-ai/totem/issues/232
 */
export async function invokeAnthropicOrchestrator(
  opts: OrchestratorInvokeOptions,
): Promise<OrchestratorResult> {
  const { prompt, model, tag } = opts;

  if (!process.env['ANTHROPIC_API_KEY']) {
    throw new TotemConfigError(
      'No Anthropic API key found.',
      'Set ANTHROPIC_API_KEY in your .env file.',
      'CONFIG_MISSING',
    );
  }

  const Anthropic = await importAnthropicSdk();
  const client = new Anthropic();

  log.info(tag, 'Invoking Anthropic API (this may take 15-60 seconds)...');
  const startMs = Date.now();

  try {
    const response = await client.messages.create({
      model,
      max_tokens: getMaxTokens(model),
      messages: [{ role: 'user' as const, content: prompt }],
    });

    const durationMs = Date.now() - startMs;

    const textParts: string[] = [];
    for (const block of response.content) {
      if (block.type === 'text') {
        textParts.push(block.text);
      }
    }

    return {
      content: textParts.join('\n'),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      durationMs,
      finishReason: response.stop_reason ?? undefined,
    };
  } catch (err) {
    if (isQuotaError(err)) {
      (err as Error).name = 'QuotaError';
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new TotemOrchestratorError(
      `Anthropic API call failed: ${msg}`,
      'Check your ANTHROPIC_API_KEY, network connection, and model name.',
    );
  }
}
