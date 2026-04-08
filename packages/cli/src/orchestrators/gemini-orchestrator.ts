import { TotemConfigError, TotemOrchestratorError } from '@mmnto/totem';

import { log } from '../ui.js';
import type { OrchestratorInvokeOptions, OrchestratorResult } from './orchestrator.js';
import { detectPackageManager, isQuotaError } from './orchestrator.js';

// ─── Constants ───────────────────────────────────────

const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;

// ─── SDK loader (BYOSD) ─────────────────────────────

async function importGeminiSdk() {
  try {
    return await import('@google/genai');
  } catch {
    throw new TotemConfigError(
      'Gemini SDK (@google/genai) is not installed.',
      `Install it with: ${detectPackageManager()} add @google/genai`,
      'CONFIG_MISSING',
    );
  }
}

// ─── Gemini API orchestrator ─────────────────────────

/**
 * Invoke the Gemini API via the `@google/genai` SDK.
 * Requires: `pnpm add @google/genai` and `GEMINI_API_KEY` env var.
 *
 * @see https://github.com/mmnto-ai/totem/issues/231
 */
export async function invokeGeminiOrchestrator(
  opts: OrchestratorInvokeOptions,
): Promise<OrchestratorResult> {
  // TODO(mmnto/totem#1291 Phase 4 — deferred to 1.16.0): When opts.systemPrompt is
  // provided AND opts.enableContextCaching is true, use the
  // `ai.caches.create({ model, contents, ttl })` lifecycle to upload the
  // persistent context, hash-key it on `compile-manifest.json`, and
  // reference it via `config: { cachedContent }` on subsequent calls.
  // Surface the cached-token count from `usageMetadata.cachedContentTokenCount`
  // (Gemini's field, not Anthropic's `cache_read_input_tokens`) into
  // OrchestratorResult.cacheReadInputTokens. Currently ignored — backward-
  // compatible no-op so the Phase 1 interface extension ships safely.
  const { prompt, model, tag } = opts;

  const apiKey = process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_API_KEY'];
  if (!apiKey) {
    throw new TotemConfigError(
      'No Gemini API key found.',
      'Set GEMINI_API_KEY (or GOOGLE_API_KEY) in your .env file.',
      'CONFIG_MISSING',
    );
  }

  const { GoogleGenAI } = await importGeminiSdk();
  const ai = new GoogleGenAI({ apiKey });

  log.info(tag, 'Invoking Gemini API (this may take 15-60 seconds)...');
  const startMs = Date.now();

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      },
    });

    const durationMs = Date.now() - startMs;
    return {
      content: response.text ?? '',
      inputTokens: response.usageMetadata?.promptTokenCount ?? null,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
      durationMs,
      finishReason: response.candidates?.[0]?.finishReason ?? undefined,
    };
  } catch (err) {
    if (isQuotaError(err)) {
      (err as Error).name = 'QuotaError';
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new TotemOrchestratorError(
      `Gemini API call failed: ${msg}`,
      'Check your GEMINI_API_KEY, network connection, and model name.',
      err,
    );
  }
}
