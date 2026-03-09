import { log } from '../ui.js';

import type { OrchestratorInvokeOptions, OrchestratorResult } from './orchestrator.js';

// ─── Constants ───────────────────────────────────────

const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;

// ─── SDK loader (BYOSD) ─────────────────────────────

async function importGeminiSdk() {
  try {
    return await import('@google/genai');
  } catch {
    throw new Error(
      '[Totem Error] Gemini SDK (@google/genai) is not installed.\n' +
        'Install it with: pnpm add @google/genai\n' +
        "Or use provider: 'shell' in your orchestrator config.",
    );
  }
}

// ─── Quota detection ─────────────────────────────────

function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if ('status' in err && (err as Record<string, unknown>).status === 429) return true;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests')
  );
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
  const { prompt, model, tag } = opts;

  const apiKey = process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_API_KEY'];
  if (!apiKey) {
    throw new Error(
      '[Totem Error] No Gemini API key found.\n' +
        'Set GEMINI_API_KEY (or GOOGLE_API_KEY) in your .env file.',
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
      config: { maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS },
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
      const quotaErr = new Error(err instanceof Error ? err.message : String(err));
      quotaErr.name = 'QuotaError';
      throw quotaErr;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[Totem Error] Gemini API call failed: ${msg}`);
  }
}
