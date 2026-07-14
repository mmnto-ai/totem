import {
  buildMissingSdkHint,
  modelStripsTemperature,
  TotemConfigError,
  TotemOrchestratorError,
} from '@mmnto/totem';

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
    // mmnto-ai/totem#2018 L2: context-correct remediation — "add the package" is the wrong
    // fix when the SDK is installed and the running BINARY can't resolve it.
    throw new TotemConfigError(
      'OpenAI SDK (openai) is not installed.',
      buildMissingSdkHint('openai', { packageManager: detectPackageManager() }),
      'CONFIG_MISSING',
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
  // mmnto/totem#1291 Phase 3: opts.systemPrompt is consumed via the
  // standard OpenAI `system` role message so the LLM receives the compiler
  // instructions correctly. Without this, Phase 3's prompt split would
  // silently strip the instructions when compile is routed to OpenAI-
  // compatible servers (LM Studio, Groq, OpenRouter, etc.), leaving the
  // model with only the lesson body. Caught by Shield AI on the first
  // push attempt — same cascade pattern as the Gemini fix.
  const { prompt, systemPrompt, model, tag, baseUrl } = opts;

  // For local servers, use a dummy key if none is set
  const apiKey = process.env['OPENAI_API_KEY'] ?? (baseUrl ? LOCAL_DUMMY_KEY : undefined);
  if (!apiKey) {
    throw new TotemConfigError(
      'No OpenAI API key found.',
      'Set OPENAI_API_KEY in your .env file, or add a baseUrl for local servers (Ollama, LM Studio).',
      'CONFIG_MISSING',
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
    const messages: { role: 'system' | 'user'; content: string }[] = [];
    // SAFETY INVARIANT: The OpenAI Chat Completions API explicitly rejects
    // messages with empty `content` (400). Skip the system role message
    // entirely when systemPrompt is undefined or empty. Matches the parallel
    // checks in anthropic/gemini/ollama after the GCA round 2 review on
    // PR mmnto/totem#1292.
    if (systemPrompt !== undefined && systemPrompt.length > 0) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    // GPT-5+ / o-series reasoning models reject the legacy `max_tokens` key
    // (400 — the API requires `max_completion_tokens`) and reject non-default
    // `temperature` (mmnto-ai/totem#1476). Older chat models and OpenAI-
    // compatible local servers (Ollama, LM Studio, Groq) keep the legacy
    // param shape — some of them do not recognize `max_completion_tokens`.
    const isReasoningFamily = modelStripsTemperature(model);
    const response = await client.chat.completions.create({
      model,
      ...(isReasoningFamily
        ? { max_completion_tokens: DEFAULT_MAX_TOKENS }
        : { max_tokens: DEFAULT_MAX_TOKENS }),
      messages,
      ...(opts.temperature !== undefined && !isReasoningFamily
        ? { temperature: opts.temperature }
        : {}),
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
    throw new TotemOrchestratorError(
      `OpenAI API call failed: ${msg}`,
      'Check your OPENAI_API_KEY, network connection, and model name.',
      err,
    );
  }
}
