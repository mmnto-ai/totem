import { log } from '../ui.js';
import type { OrchestratorInvokeOptions, OrchestratorResult } from './orchestrator.js';
import { detectPackageManager, isQuotaError } from './orchestrator.js';

// ─── Constants ───────────────────────────────────────

const DEFAULT_MAX_TOKENS = 16_384;

// ─── SDK loader (BYOSD) ─────────────────────────────

async function importAnthropicSdk() {
  try {
    return (await import('@anthropic-ai/sdk')).default;
  } catch {
    throw new Error(
      '[Totem Error] Anthropic SDK (@anthropic-ai/sdk) is not installed.\n' +
        `Install it with: ${detectPackageManager()} add @anthropic-ai/sdk\n` +
        "Or use provider: 'shell' in your orchestrator config.",
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
    throw new Error(
      '[Totem Error] No Anthropic API key found.\n' + 'Set ANTHROPIC_API_KEY in your .env file.',
    );
  }

  const Anthropic = await importAnthropicSdk();
  const client = new Anthropic();

  log.info(tag, 'Invoking Anthropic API (this may take 15-60 seconds)...');
  const startMs = Date.now();

  try {
    const response = await client.messages.create({
      model,
      max_tokens: DEFAULT_MAX_TOKENS,
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
      const quotaErr = new Error((err as Error).message);
      quotaErr.name = 'QuotaError';
      throw quotaErr;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[Totem Error] Anthropic API call failed: ${msg}`);
  }
}
