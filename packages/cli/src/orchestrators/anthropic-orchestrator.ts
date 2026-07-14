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

const DEFAULT_MAX_TOKENS = 8_192;
/** Opus-tier / current-generation output headroom (adaptive thinking draws from max_tokens). */
const CURRENT_GEN_MAX_TOKENS = 16_384;

/** Model-aware max output tokens — prevents API errors on smaller models. */
function getMaxTokens(model: string): number {
  // Haiku keeps its conservative cap even for future 5+ variants — their
  // output ceiling is unknown, and 4K is the proven-safe allocation. Revisit
  // when a Haiku 5 actually ships (review-lane finding, 2026-07-14).
  if (model.includes('haiku')) return 4_096;
  // Current-generation models (Sonnet 5+ / Opus 4.7+ / Fable) run adaptive
  // thinking when the `thinking` param is omitted, and thinking tokens draw
  // from max_tokens — the 8K Sonnet cap truncated Sonnet 5 review verdicts
  // mid-JSON (output == cap exactly, lane abstained). Give the family
  // Opus-level headroom.
  if (modelStripsTemperature(model)) return CURRENT_GEN_MAX_TOKENS;
  if (model.includes('sonnet')) return DEFAULT_MAX_TOKENS;
  if (model.includes('opus')) return CURRENT_GEN_MAX_TOKENS;
  return DEFAULT_MAX_TOKENS;
}

// ─── SDK loader (BYOSD) ─────────────────────────────

async function importAnthropicSdk() {
  try {
    return (await import('@anthropic-ai/sdk')).default;
  } catch {
    // mmnto-ai/totem#2018 L2: context-correct remediation — "add the package" is the wrong
    // fix when the SDK is installed and the running BINARY can't resolve it.
    throw new TotemConfigError(
      'Anthropic SDK (@anthropic-ai/sdk) is not installed.',
      buildMissingSdkHint('@anthropic-ai/sdk', { packageManager: detectPackageManager() }),
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
/**
 * Build the `system` field for the Anthropic request body based on the
 * caching opt-in (mmnto/totem#1291 Phase 2).
 *
 * Three modes:
 *   1. systemPrompt undefined           → returns undefined (no system field —
 *                                          today's call shape, fully backward-
 *                                          compatible)
 *   2. systemPrompt + caching disabled  → returns the string form (Anthropic
 *                                          accepts `system: string` natively;
 *                                          no cache_control directive)
 *   3. systemPrompt + caching enabled   → returns the array form with
 *                                          `cache_control: { type: 'ephemeral' }`
 *                                          on the system block. Optional
 *                                          `ttl: '1h'` when cacheTTL >= 3600;
 *                                          otherwise the API defaults to the
 *                                          5-minute ephemeral cache.
 *
 * Anthropic only supports two TTL values today (5m default, 1h extended).
 * cacheTTL values other than 3600 fall back to the 5m default rather than
 * being rejected — the schema already validates positive integers, and the
 * 5m default covers the dominant CI use case per the epic acceptance criteria.
 */
function buildSystemField(
  systemPrompt: string | undefined,
  enableContextCaching: boolean | undefined,
  cacheTTL: number | undefined,
):
  | undefined
  | string
  | Array<{
      type: 'text';
      text: string;
      cache_control: { type: 'ephemeral'; ttl?: '1h' };
    }> {
  // SAFETY INVARIANT: Anthropic rejects empty `system` strings with a 400
  // error. Treat empty/whitespace-only systemPrompt the same as undefined
  // — return early so the request omits the field entirely. Matches the
  // existing pattern in shell-orchestrator.ts and the parallel checks in
  // gemini/openai/ollama after the GCA round 2 review on PR mmnto/totem#1292.
  if (systemPrompt === undefined || systemPrompt.length === 0) return undefined;
  if (!enableContextCaching) return systemPrompt;

  const cacheControl: { type: 'ephemeral'; ttl?: '1h' } = { type: 'ephemeral' };
  if (cacheTTL !== undefined && cacheTTL >= 3600) {
    cacheControl.ttl = '1h';
  }

  return [
    {
      type: 'text' as const,
      text: systemPrompt,
      cache_control: cacheControl,
    },
  ];
}

export async function invokeAnthropicOrchestrator(
  opts: OrchestratorInvokeOptions,
): Promise<OrchestratorResult> {
  const { prompt, systemPrompt, model, tag, enableContextCaching, cacheTTL } = opts;

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

  const systemField = buildSystemField(systemPrompt, enableContextCaching, cacheTTL);

  try {
    const response = await client.messages.create({
      model,
      max_tokens: getMaxTokens(model),
      ...(systemField !== undefined ? { system: systemField } : {}),
      messages: [{ role: 'user' as const, content: prompt }],
      // Opus 4.7+ / Sonnet 5+ / Fable reject client sampling params with a
      // 400 — omit temperature entirely for them (mmnto-ai/totem#1476). The
      // caller's declared value still reaches models that accept it; the
      // compile-worker fingerprint records the same absence.
      ...(opts.temperature !== undefined && !modelStripsTemperature(model)
        ? { temperature: opts.temperature }
        : {}),
    });

    const durationMs = Date.now() - startMs;

    const textParts: string[] = [];
    for (const block of response.content) {
      if (block.type === 'text') {
        textParts.push(block.text);
      }
    }

    // Cache token observability (mmnto/totem#1291 Phase 2). Anthropic returns
    // these fields on the usage object only when prompt caching is active —
    // null fallback covers responses where the SDK omitted them entirely
    // (no caching requested) or set them to null (no hit/miss recorded).
    const usage = response.usage as typeof response.usage & {
      cache_read_input_tokens?: number | null;
      cache_creation_input_tokens?: number | null;
    };

    return {
      content: textParts.join('\n'),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      durationMs,
      finishReason: response.stop_reason ?? undefined,
      cacheReadInputTokens: usage.cache_read_input_tokens ?? null,
      cacheCreationInputTokens: usage.cache_creation_input_tokens ?? null,
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
      err,
    );
  }
}
