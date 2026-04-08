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
  // mmnto/totem#1291 Phase 3: opts.systemPrompt is consumed via Gemini's
  // native `config.systemInstruction` field so the LLM receives the
  // compiler instructions correctly. Without this, Phase 3's prompt split
  // (compilerPrompt → systemPrompt) would silently strip the instructions
  // when compile is routed to Gemini, leaving the model with only the
  // lesson body. Caught by Shield AI on the first push attempt — see
  // .totem/lessons/lesson-400fed87.md (read-path schema changes break
  // write-path invariants).
  //
  // TODO(mmnto/totem#1291 Phase 4 — deferred to 1.16.0): When
  // opts.enableContextCaching is true, use the `ai.caches.create({ model,
  // contents, ttl })` lifecycle to upload the persistent context, hash-key
  // it on `compile-manifest.json`, and reference it via
  // `config: { cachedContent }` on subsequent calls. Surface the cached-
  // token count from `usageMetadata.cachedContentTokenCount` (Gemini's
  // field, not Anthropic's `cache_read_input_tokens`) into
  // OrchestratorResult.cacheReadInputTokens. The systemInstruction wiring
  // in Phase 3 is the foundation Phase 4 will build on.
  const { prompt, systemPrompt, model, tag } = opts;

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
        ...(systemPrompt !== undefined ? { systemInstruction: systemPrompt } : {}),
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
