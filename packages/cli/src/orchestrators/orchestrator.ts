import type { Orchestrator as OrchestratorConfig } from '@mmnto/totem';

import { invokeShellOrchestrator } from './shell-orchestrator.js';

// ─── Shared types ────────────────────────────────────

export interface OrchestratorResult {
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
  finishReason?: string;
}

export interface OrchestratorInvokeOptions {
  prompt: string;
  model: string;
  cwd: string;
  tag: string;
  totemDir: string;
}

/** A provider-bound function that invokes an LLM and returns the result. */
export type InvokeOrchestrator = (
  options: OrchestratorInvokeOptions,
) => Promise<OrchestratorResult>;

// ─── Package manager detection (#236) ───────────────

/**
 * Detect the active package manager from the `npm_config_user_agent` env var
 * (set by npm, pnpm, yarn, and bun when running scripts). Falls back to `npm`.
 */
export function detectPackageManager(): string {
  const ua = process.env['npm_config_user_agent'] ?? '';
  if (ua.startsWith('pnpm')) return 'pnpm';
  if (ua.startsWith('yarn')) return 'yarn';
  if (ua.startsWith('bun')) return 'bun';
  return 'npm';
}

// ─── Quota detection (shared) ────────────────────────

/**
 * Detect whether an error is a rate-limit / quota-exhaustion response.
 * Used by both Gemini and Anthropic orchestrators to normalize QuotaError.
 */
export function isQuotaError(err: unknown): boolean {
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

// ─── Model string parsing (#243) ─────────────────────

const KNOWN_PROVIDERS = ['gemini', 'anthropic', 'openai', 'shell'] as const;

/**
 * Parse a `provider:model` string into its components.
 * If the prefix before the first colon is a known provider, splits it out.
 * Otherwise, returns the full string as the model with the default provider.
 */
export function parseModelString(
  value: string,
  defaultProvider: string,
): { provider: string; model: string } {
  const colonIdx = value.indexOf(':');
  if (colonIdx > 0) {
    const prefix = value.slice(0, colonIdx);
    if ((KNOWN_PROVIDERS as readonly string[]).includes(prefix)) {
      return { provider: prefix, model: value.slice(colonIdx + 1) };
    }
  }
  return { provider: defaultProvider, model: value };
}

// ─── Centralized model resolution (#248) ────────────

/** Characters allowed in model names — restricts shell metacharacters. */
const MODEL_NAME_RE = /^[\w./:_-]+$/;

export interface ResolvedOrchestrator {
  parsed: { provider: string; model: string };
  invoke: InvokeOrchestrator;
  qualifiedModel: string;
}

/**
 * Parse and validate a model string, resolve cross-provider routing,
 * and return the appropriate invoker. Centralizes the validation logic
 * to guarantee symmetric validation across primary and fallback paths.
 */
export function resolveOrchestrator(
  rawModel: string,
  baseProvider: string,
  baseInvoke: InvokeOrchestrator,
): ResolvedOrchestrator {
  if (rawModel.startsWith('-') || !MODEL_NAME_RE.test(rawModel)) {
    throw new Error(
      `[Totem Error] Invalid model name '${rawModel}'. Model names may only contain word characters, dots, slashes, colons, underscores, and hyphens.`,
    );
  }

  const parsed = parseModelString(rawModel, baseProvider);

  if (parsed.provider === 'shell' && baseProvider !== 'shell') {
    throw new Error(
      `[Totem Error] Cannot route to 'shell' provider from a '${baseProvider}' config.\n` +
        `The shell provider requires a 'command' template in the orchestrator config.`,
    );
  }

  if (!parsed.model || parsed.model.startsWith('-')) {
    throw new Error(
      `[Totem Error] Invalid model name in '${rawModel}'. The model portion must not be empty or start with a hyphen.`,
    );
  }

  const invoke =
    parsed.provider === baseProvider
      ? baseInvoke
      : createOrchestrator({ provider: parsed.provider } as Parameters<
          typeof createOrchestrator
        >[0]);

  return { parsed, invoke, qualifiedModel: rawModel };
}

// ─── Factory ─────────────────────────────────────────

/**
 * Create an orchestrator invoker bound to the given provider config.
 * Mirrors the `createEmbedder()` pattern from `packages/core/src/embedders/`.
 */
export function createOrchestrator(config: OrchestratorConfig): InvokeOrchestrator {
  switch (config.provider) {
    case 'shell':
      return (opts) => invokeShellOrchestrator({ ...opts, command: config.command });
    case 'gemini':
      return async (opts) => {
        const { invokeGeminiOrchestrator } = await import('./gemini-orchestrator.js');
        return invokeGeminiOrchestrator(opts);
      };
    case 'anthropic':
      return async (opts) => {
        const { invokeAnthropicOrchestrator } = await import('./anthropic-orchestrator.js');
        return invokeAnthropicOrchestrator(opts);
      };
    case 'openai':
      return async (opts) => {
        const { invokeOpenAIOrchestrator } = await import('./openai-orchestrator.js');
        return invokeOpenAIOrchestrator({ ...opts, baseUrl: config.baseUrl });
      };
  }
}
