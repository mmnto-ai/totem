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

const KNOWN_PROVIDERS = ['gemini', 'anthropic', 'openai', 'ollama', 'shell'] as const;

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

// ─── CLI fallback infrastructure ─────────────────────

/** Map provider names to their CLI command templates. {file} and {model} are replaced at runtime. */
const CLI_FALLBACK_COMMANDS: Record<string, string> = {
  gemini: 'gemini -e none -m {model} < {file}',
  anthropic: 'claude -p {file} --model {model}',
};

/** Check if a CLI binary is available on PATH. */
async function isCliAvailable(binary: string): Promise<boolean> {
  const { spawn } = await import('node:child_process');
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => {
    const child = spawn(cmd, [binary], { stdio: 'pipe' });
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 5000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/** Map provider to CLI binary name. */
const CLI_BINARIES: Record<string, string> = {
  gemini: 'gemini',
  anthropic: 'claude',
};

/**
 * Detect whether an error is a missing-SDK or missing-API-key error.
 * These are the two classes of error that warrant a CLI fallback.
 */
function isFallbackEligible(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('is not installed') ||
    msg.includes('no gemini api key') ||
    msg.includes('no anthropic api key') ||
    msg.includes('no openai api key') ||
    msg.includes('cannot find module')
  );
}

/**
 * Wrap an SDK-based invoker with CLI fallback logic.
 * If the SDK invoker fails due to a missing SDK or API key,
 * and the provider's CLI is on PATH, fall back to shell orchestrator.
 */
function withCliFallback(provider: string, sdkInvoker: InvokeOrchestrator): InvokeOrchestrator {
  const binary = CLI_BINARIES[provider];
  const command = CLI_FALLBACK_COMMANDS[provider];

  // No CLI fallback defined for this provider — use SDK directly
  if (!binary || !command) return sdkInvoker;

  return async (opts) => {
    try {
      return await sdkInvoker(opts);
    } catch (err) {
      if (!isFallbackEligible(err)) throw err;

      if (!(await isCliAvailable(binary))) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `[Totem Error] CLI fallback for '${provider}' unavailable: '${binary}' not found on PATH.\n` +
            `Original error: ${msg}\n` +
            `Install the ${provider} CLI or its SDK to use this provider.`,
        );
      }

      const { log } = await import('../ui.js');
      log.warn(opts.tag, `SDK unavailable, falling back to ${binary} CLI...`);
      return invokeShellOrchestrator({ ...opts, command });
    }
  };
}

// ─── Factory ─────────────────────────────────────────

/**
 * Create an orchestrator invoker bound to the given provider config.
 * SDK-based providers are wrapped with CLI fallback logic: if the SDK
 * or API key is missing but the provider's CLI is on PATH, Totem falls
 * back to the shell orchestrator automatically.
 */
export function createOrchestrator(config: OrchestratorConfig): InvokeOrchestrator {
  switch (config.provider) {
    case 'shell':
      return (opts) => invokeShellOrchestrator({ ...opts, command: config.command });
    case 'gemini':
      return withCliFallback('gemini', async (opts) => {
        const { invokeGeminiOrchestrator } = await import('./gemini-orchestrator.js');
        return invokeGeminiOrchestrator(opts);
      });
    case 'anthropic':
      return withCliFallback('anthropic', async (opts) => {
        const { invokeAnthropicOrchestrator } = await import('./anthropic-orchestrator.js');
        return invokeAnthropicOrchestrator(opts);
      });
    case 'openai':
      return async (opts) => {
        const { invokeOpenAIOrchestrator } = await import('./openai-orchestrator.js');
        return invokeOpenAIOrchestrator({ ...opts, baseUrl: config.baseUrl });
      };
    case 'ollama':
      return async (opts) => {
        const { invokeOllamaOrchestrator } = await import('./ollama-orchestrator.js');
        return invokeOllamaOrchestrator({
          ...opts,
          baseUrl: config.baseUrl,
          numCtx: config.numCtx,
        });
      };
  }
}
