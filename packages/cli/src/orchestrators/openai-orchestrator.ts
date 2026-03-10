import { log } from '../ui.js';
import type { OrchestratorInvokeOptions, OrchestratorResult } from './orchestrator.js';
import { detectPackageManager, isQuotaError } from './orchestrator.js';

// ─── Constants ───────────────────────────────────────

const DEFAULT_MAX_TOKENS = 16_384;

/**
 * Dummy API key for local OpenAI-compatible servers (Ollama, LM Studio)
 * that don't require authentication but where the SDK mandates a key.
 */
const LOCAL_DUMMY_KEY = 'totem-local';

// ─── SDK loader (BYOSD) ─────────────────────────────

async function importOpenAISdk() {
  try {
    return (await import('openai')).default;
  } catch {
    throw new Error(
      '[Totem Error] OpenAI SDK (openai) is not installed.\n' +
        `Install it with: ${detectPackageManager()} add openai\n` +
        "Or use provider: 'shell' in your orchestrator config.",
    );
  }
}

// ─── OpenAI-compatible API orchestrator ─────────────

/**
 * Invoke an OpenAI-compatible API via the `openai` SDK.
 * Supports OpenAI, Ollama, LM Studio, Groq, OpenRouter, and any
 * server implementing the `/v1/chat/completions` endpoint.
 *
 * @see https://github.com/mmnto-ai/totem/issues/285
 */
export async function invokeOpenAIOrchestrator(
  opts: OrchestratorInvokeOptions & { baseUrl?: string },
): Promise<OrchestratorResult> {
  const { prompt, model, tag, baseUrl } = opts;

  // For local servers, use a dummy key if none is set
  const apiKey = process.env['OPENAI_API_KEY'] ?? (baseUrl ? LOCAL_DUMMY_KEY : undefined);
  if (!apiKey) {
    throw new Error(
      '[Totem Error] No OpenAI API key found.\n' +
        'Set OPENAI_API_KEY in your .env file, or add a baseUrl for local servers (Ollama, LM Studio).',
    );
  }

  const OpenAI = await importOpenAISdk();
  const client = new OpenAI({
    apiKey,
    ...(baseUrl && { baseURL: baseUrl }),
  });

  const serverLabel = baseUrl ? `OpenAI-compatible API (${baseUrl})` : 'OpenAI API';
  log.info(tag, `Invoking ${serverLabel} (this may take 15-60 seconds)...`);
  const startMs = Date.now();

  try {
    const response = await client.chat.completions.create({
      model,
      max_tokens: DEFAULT_MAX_TOKENS,
      messages: [{ role: 'user' as const, content: prompt }],
    });

    const durationMs = Date.now() - startMs;
    const choice = response.choices[0];

    return {
      content: choice?.message?.content ?? '',
      inputTokens: response.usage?.prompt_tokens ?? null,
      outputTokens: response.usage?.completion_tokens ?? null,
      durationMs,
      finishReason: choice?.finish_reason ?? undefined,
    };
  } catch (err) {
    if (isQuotaError(err)) {
      (err as Error).name = 'QuotaError';
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[Totem Error] OpenAI API call failed: ${msg}`);
  }
}
