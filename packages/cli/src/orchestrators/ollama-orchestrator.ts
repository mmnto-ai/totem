import { TotemOrchestratorError, TotemParseError } from '@mmnto/totem';
import { z } from 'zod';

import { log } from '../ui.js';
import type { OrchestratorInvokeOptions, OrchestratorResult } from './orchestrator.js';
import { isQuotaError } from './orchestrator.js';

// ─── Constants ───────────────────────────────────────

const DEFAULT_BASE_URL = 'http://localhost:11434';

// ─── Response schema ────────────────────────────────

const OllamaChatResponseSchema = z.object({
  message: z.object({ content: z.string().optional() }).optional(),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
  done: z.boolean().optional(),
  done_reason: z.string().optional(),
});

// ─── Native Ollama orchestrator ─────────────────────

/**
 * Invoke Ollama's native /api/chat endpoint directly via fetch.
 * Unlike the OpenAI-compatible adapter, this supports passing `num_ctx`
 * to dynamically control context length (and VRAM usage).
 *
 * @see https://github.com/mmnto-ai/totem/issues/298
 */
export async function invokeOllamaOrchestrator(
  opts: OrchestratorInvokeOptions & { baseUrl?: string; numCtx?: number },
): Promise<OrchestratorResult> {
  const { prompt, model, tag, baseUrl, numCtx } = opts;

  // Normalize base URL (strip trailing slash)
  const base = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const url = `${base}/api/chat`;

  const ctxLabel = numCtx ? ` (num_ctx: ${numCtx})` : '';
  log.info(tag, `Invoking Ollama at ${base}${ctxLabel} (this may take 15-60 seconds)...`);
  const startMs = Date.now();

  const body: Record<string, unknown> = {
    model,
    stream: false,
    messages: [{ role: 'user', content: prompt }],
  };

  // Only inject num_ctx if explicitly configured
  if (numCtx) {
    body.options = { num_ctx: numCtx };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TotemOrchestratorError(
      `Cannot connect to Ollama at ${base}. Details: ${msg}`,
      'Is Ollama running? Start it with: ollama serve',
    );
  }

  if (!response.ok) {
    const errorBody = await response.text();

    if (isQuotaError(Object.assign(new Error(errorBody), { status: response.status }))) {
      const err = new Error(`Ollama rate limit: ${errorBody}`);
      err.name = 'QuotaError';
      throw err;
    }

    // 500 errors from Ollama are often VRAM/context exhaustion
    if (response.status >= 500) {
      throw new TotemOrchestratorError(
        `Ollama server error (${response.status}): ${errorBody}`,
        numCtx
          ? `Try lowering numCtx (currently ${numCtx}) in your orchestrator config.`
          : 'Try setting a smaller numCtx in your orchestrator config to limit VRAM usage.',
      );
    }

    throw new TotemOrchestratorError(
      `Ollama API error (${response.status}): ${errorBody}`,
      'Check that the model is pulled and Ollama is running correctly.',
    );
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new TotemParseError(
      'Ollama returned invalid JSON.',
      'Ensure the model is fully loaded. Try: ollama pull <model>',
    );
  }

  const parsed = OllamaChatResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TotemParseError(
      `Unexpected response from Ollama API. Validation: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
      'Ensure Ollama is up to date. Try: ollama --version',
    );
  }
  const data = parsed.data;
  const durationMs = Date.now() - startMs;

  return {
    content: data.message?.content ?? '',
    inputTokens: data.prompt_eval_count ?? null,
    outputTokens: data.eval_count ?? null,
    durationMs,
    finishReason: data.done_reason ?? (data.done ? 'stop' : undefined),
  };
}
