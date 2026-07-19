import type {
  BackendAdmissionClass,
  ContextPolicy,
  GroundingBundle,
  InvokeFailureKind,
  Orchestrator as OrchestratorConfig,
  OutputContract,
  RunMetadata,
} from '@mmnto/totem';
import { TotemConfigError, TotemOrchestratorError } from '@mmnto/totem';

import { invokeShellOrchestrator } from './shell-orchestrator.js';

// ─── Shared types ────────────────────────────────────

export type RuntimeInvokeRoute =
  | 'sdk'
  | 'cli-fallback'
  | 'configured-shell'
  | 'quota-model-fallback';

/**
 * Byte-bounded process text retained in memory until the CLI seam applies
 * secret masking. This is intentionally distinct from core's persisted
 * `BoundedTextEvidence`: shell execution must never claim raw text is masked.
 */
export interface RuntimeBoundedTextEvidence {
  encoding: 'utf-8';
  head: string;
  tail?: string;
  observedBytes: number;
  retainedBytes: number;
  limitBytes: number;
  truncated: boolean;
}

export interface RuntimeProcessEvidence {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  timeoutMs?: number;
  stdout?: RuntimeBoundedTextEvidence;
  stderr?: RuntimeBoundedTextEvidence;
}

/** Raw, bounded invocation evidence. `runOrchestrator` masks it before persistence. */
export interface RuntimeInvokeAttemptEvidence {
  sequence: number;
  route: RuntimeInvokeRoute;
  provider: string;
  model: string;
  status: 'succeeded' | 'failed';
  durationMs: number;
  failureKind?: InvokeFailureKind;
  providerStatus?: number;
  providerCode?: string;
  process?: RuntimeProcessEvidence;
}

export interface OrchestratorResult {
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
  finishReason?: string;
  /**
   * Tokens read from prompt cache on this call (mmnto/totem#1291 Phase 2). Populated by
   * providers that support prompt caching when `enableContextCaching` is true
   * and a cache hit occurred. Null when caching wasn't requested or the
   * provider doesn't support it. Distinct from `inputTokens`, which counts
   * cached + uncached + ephemeral combined for the request as a whole.
   */
  cacheReadInputTokens?: number | null;
  /**
   * Tokens written to prompt cache on this call (mmnto/totem#1291 Phase 2). Populated
   * only when a cache miss occurred and the provider wrote a new cache entry.
   * Null otherwise.
   */
  cacheCreationInputTokens?: number | null;
  /**
   * Raw bounded execution provenance. Present only when transport provenance
   * is material (configured shell or a fallback leg); masked before artifacts
   * are persisted.
   */
  attempts?: RuntimeInvokeAttemptEvidence[];
}

export interface OrchestratorInvokeOptions {
  prompt: string;
  /**
   * Optional persistent system context that providers may cache (mmnto/totem#1291
   * Proposal 217). When provided AND `enableContextCaching` is true,
   * Anthropic providers (Phase 2) will mark this with a `cache_control:
   * ephemeral` directive so subsequent calls within the TTL window read
   * from prompt cache instead of paying full input-token cost. Backward
   * compatible: when omitted, the call shape is identical to today
   * (single user message, no caching).
   */
  systemPrompt?: string;
  model: string;
  cwd: string;
  tag: string;
  totemDir: string;
  /** LLM temperature: 0 = deterministic, 0.7 = creative. Caller sets per use case. */
  temperature?: number;
  /**
   * Whether to request provider-native prompt caching (mmnto/totem#1291 Phase 2).
   * Threaded through from `orchestrator.enableContextCaching` config. When
   * true AND `systemPrompt` is provided, the provider implementation MAY
   * emit a cache directive. When false (default), providers behave exactly
   * as today.
   */
  enableContextCaching?: boolean;
  /**
   * Cache TTL in seconds (mmnto/totem#1291 Phase 2). 300 = 5min (Anthropic default
   * ephemeral), 3600 = 1h (Anthropic extended cache). Only consulted by
   * providers that support caching when `enableContextCaching` is true.
   */
  cacheTTL?: number;

  // ─── Admission contract transport (mmnto-ai/totem#2102, strategy#474 slice 3) ──
  //
  // Providers are PURE TRANSPORT for these six fields: every vendor payload is
  // built explicitly field-by-field, so no provider reads or acts on any of
  // them this slice. Admission is decided in `runOrchestrator` (CLI seam);
  // output enforcement is caller-side post-invocation (#2103) — Totem is not
  // zero-user, so backend cooperation is never assumed.

  /** Neutral task identity for routing/telemetry. Defaults to `tag` at the CLI seam — `tag` stays the UI/cache key. */
  task?: string;
  /** The delivered grounding identity (mmnto-ai/totem#2101), reconciled with `artifact.bundle` at the CLI seam. */
  groundingBundle?: GroundingBundle;
  /** Requested admission class — gated against `orchestrator.capabilities.admissionClasses` BEFORE any invoke. */
  backendAdmissionClass?: BackendAdmissionClass;
  /** Advisory context policy (budget unit: input tokens). Recorded, never enforced here. */
  contextPolicy?: ContextPolicy;
  /** Caller-declared output contract. Read by #2103 post-checks, never by providers. */
  outputContract?: OutputContract;
  /** Caller identity metadata, recorded verbatim into the run artifact. */
  runMetadata?: RunMetadata;
}

/** A provider-bound function that invokes an LLM and returns the result. */
export type InvokeOrchestrator = (
  options: OrchestratorInvokeOptions,
) => Promise<OrchestratorResult>;

const INVOKE_RECOVERY_HINT_LIMIT_BYTES = 1024;

function boundUtf8Text(value: string, limitBytes: number): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= limitBytes) return value;
  return bytes
    .subarray(0, limitBytes)
    .toString('utf8')
    .replace(/\uFFFD$/u, '');
}

function defaultInvokeRecoveryHint(kind: InvokeFailureKind): string {
  switch (kind) {
    case 'auth':
      return 'Check the provider login or API key, then retry the invocation.';
    case 'quota':
      return 'Wait for quota to reset, increase provider quota, or configure an available fallbackModel.';
    case 'model':
      return 'Select a model that is available to the configured provider account.';
    case 'process-spawn':
      return 'Install the configured CLI, verify it is on PATH, and check the shell command.';
    case 'process-exit':
      return 'Inspect the bounded invocation evidence, correct the CLI/provider failure, and retry.';
    case 'timeout':
      return 'Reduce the request workload or fix provider availability, then retry.';
    case 'unknown':
      return 'Inspect the invocation failure artifact and provider status, then retry.';
  }
}

function normalizeTotemErrorBody(message: string): string {
  return message.replace(/^(?:\[Totem Error\]\s*)+/u, '');
}

/**
 * Stable invocation failure surface consumed by run-artifact persistence and
 * review-fan diagnostics. Process text in `attempts` is bounded but not yet
 * DLP-masked; callers must not persist it directly.
 */
export class OrchestratorInvokeError extends TotemOrchestratorError {
  override readonly code = 'ORCHESTRATOR_UNAVAILABLE' as const;
  readonly kind: InvokeFailureKind;
  readonly attempts: RuntimeInvokeAttemptEvidence[];
  failureArtifactHash?: string;

  constructor(
    message: string,
    kind: InvokeFailureKind,
    attempts: RuntimeInvokeAttemptEvidence[],
    options?: { cause?: unknown; failureArtifactHash?: string; recoveryHint?: string },
  ) {
    super(
      normalizeTotemErrorBody(message),
      boundUtf8Text(
        options?.recoveryHint ?? defaultInvokeRecoveryHint(kind),
        INVOKE_RECOVERY_HINT_LIMIT_BYTES,
      ),
      options?.cause,
    );
    this.name = kind === 'quota' ? 'QuotaError' : 'OrchestratorInvokeError';
    this.kind = kind;
    this.attempts = attempts;
    this.failureArtifactHash = options?.failureArtifactHash;
  }
}

const ERROR_CAUSE_MAX_DEPTH = 8;

/** Bounded, cycle-safe traversal for provider metadata wrapped by Totem errors. */
function errorCauseChain(err: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (
    current !== null &&
    (typeof current === 'object' || typeof current === 'function') &&
    chain.length < ERROR_CAUSE_MAX_DEPTH &&
    !seen.has(current)
  ) {
    chain.push(current);
    seen.add(current);
    try {
      current = (current as Record<string, unknown>)['cause'];
      // totem-context: intentional cleanup — a hostile cause getter ends this bounded, cycle-safe traversal at the last readable error; the already-collected evidence remains usable.
    } catch {
      break;
    }
  }
  return chain;
}

function numericProperty(err: unknown, names: readonly string[]): number | undefined {
  for (const item of errorCauseChain(err)) {
    for (const name of names) {
      let value: unknown;
      try {
        value = (item as Record<string, unknown>)[name];
        // totem-context: intentional cleanup — provider errors may expose hostile numeric getters; skip an unreadable field while bounded cause traversal continues.
      } catch {
        continue;
      }
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
  }
  return undefined;
}

function stringProperties(err: unknown, names: readonly string[]): string[] {
  const values: string[] = [];
  for (const item of errorCauseChain(err)) {
    for (const name of names) {
      let value: unknown;
      try {
        value = (item as Record<string, unknown>)[name];
        // totem-context: intentional cleanup — provider errors may expose hostile string getters; skip an unreadable field while bounded cause traversal continues.
      } catch {
        continue;
      }
      if (typeof value === 'string' && value.length > 0) values.push(value);
    }
  }
  return values;
}

export interface InvokeFailureContext {
  timedOut?: boolean;
  spawnFailed?: boolean;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
}

/**
 * Deterministically classify an invocation failure. Structured process facts
 * and provider status/code win over message heuristics; unmatched failures
 * remain fail-honest as `unknown`.
 */
export function classifyInvokeFailure(
  err: unknown,
  context: InvokeFailureContext = {},
): InvokeFailureKind {
  if (context.timedOut) return 'timeout';
  if (context.spawnFailed) return 'process-spawn';
  if (!(err instanceof Error)) {
    return context.exitCode !== undefined || context.signal !== undefined
      ? 'process-exit'
      : 'unknown';
  }

  const status = numericProperty(err, ['status', 'statusCode']);
  const normalizedCodes = stringProperties(err, ['code', 'type']).map((value) =>
    value.toLowerCase(),
  );
  const hasCode = (predicate: (code: string) => boolean) => normalizedCodes.some(predicate);
  const message = err.message.toLowerCase();

  if (hasCode((code) => code === 'etimedout' || code === 'abort_err')) return 'timeout';
  if (hasCode((code) => ['enoent', 'eacces', 'enoexec'].includes(code))) return 'process-spawn';

  // Structured provider metadata is authoritative. In particular, an auth or
  // model status/code must not be reclassified as quota merely because the
  // provider's prose happens to mention quota or rate limits.
  if (
    status === 429 ||
    hasCode((code) => code.includes('rate_limit') || code.includes('quota')) ||
    stringProperties(err, ['name']).includes('QuotaError') ||
    stringProperties(err, ['kind']).includes('quota')
  ) {
    return 'quota';
  }
  if (
    status === 401 ||
    status === 403 ||
    hasCode((code) => code.includes('auth') || code.includes('api_key'))
  ) {
    return 'auth';
  }
  if (hasCode((code) => code.includes('model'))) return 'model';
  if (
    message.includes('429') ||
    message.includes('quota') ||
    message.includes('rate limit') ||
    message.includes('too many requests')
  ) {
    return 'quota';
  }
  if (
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('authentication') ||
    message.includes('invalid api key') ||
    message.includes('no anthropic api key') ||
    message.includes('no gemini api key') ||
    message.includes('no openai api key')
  ) {
    return 'auth';
  }
  if (
    message.includes('model not found') ||
    message.includes('unknown model') ||
    message.includes('model unavailable') ||
    message.includes('does not exist') ||
    (message.includes('model') && message.includes('not installed'))
  ) {
    return 'model';
  }
  if (context.exitCode !== undefined || context.signal !== undefined) return 'process-exit';
  return 'unknown';
}

function providerMetadata(err: unknown): { providerStatus?: number; providerCode?: string } {
  if (!(err instanceof Error)) return {};
  const providerStatus = numericProperty(err, ['status', 'statusCode']);
  const providerCodes = stringProperties(err, ['code', 'type']);
  const providerCode =
    providerCodes.find((code) => code !== 'ORCHESTRATOR_UNAVAILABLE') ?? providerCodes[0];
  return {
    ...(providerStatus !== undefined ? { providerStatus } : {}),
    ...(providerCode !== undefined ? { providerCode } : {}),
  };
}

function failedRuntimeAttempt(
  provider: string,
  model: string,
  route: RuntimeInvokeRoute,
  durationMs: number,
  err: unknown,
  context: InvokeFailureContext = {},
): RuntimeInvokeAttemptEvidence {
  const failureKind = classifyInvokeFailure(err, context);
  return {
    sequence: 1,
    route,
    provider,
    model,
    status: 'failed',
    durationMs,
    failureKind,
    ...providerMetadata(err),
  };
}

function recoveryHintProperty(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined;
  const recoveryHint = (err as unknown as Record<string, unknown>)['recoveryHint'];
  return typeof recoveryHint === 'string' && recoveryHint.length > 0 ? recoveryHint : undefined;
}

/**
 * Normalize any provider throw at the invocation boundary. Existing structured
 * errors retain identity; legacy Totem/provider errors remain available as the
 * cause and keep their recovery hint while gaining typed attempt evidence.
 */
export function toOrchestratorInvokeError(args: {
  err: unknown;
  provider: string;
  model: string;
  route: RuntimeInvokeRoute;
  durationMs: number;
}): OrchestratorInvokeError {
  if (args.err instanceof OrchestratorInvokeError) return args.err;

  const attempt = failedRuntimeAttempt(
    args.provider,
    args.model,
    args.route,
    args.durationMs,
    args.err,
  );
  const message =
    args.err instanceof Error
      ? args.err.message
      : `Invocation failed for '${args.provider}' with a non-Error rejection.`;
  const recoveryHint = recoveryHintProperty(args.err);
  return new OrchestratorInvokeError(message, attempt.failureKind ?? 'unknown', [attempt], {
    cause: args.err,
    ...(recoveryHint !== undefined ? { recoveryHint } : {}),
  });
}

function resequenceAttempts(
  attempts: readonly RuntimeInvokeAttemptEvidence[],
): RuntimeInvokeAttemptEvidence[] {
  return attempts.map((attempt, index) => ({ ...attempt, sequence: index + 1 }));
}

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
  if (err.name === 'QuotaError') return true;
  if ('kind' in err && (err as Record<string, unknown>).kind === 'quota') return true;
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

export const KNOWN_PROVIDERS = ['gemini', 'anthropic', 'openai', 'ollama', 'shell'] as const;

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

/**
 * Validate a model name string against shell-safety gates. Single source of
 * truth for both `resolveOrchestrator` (config-load, raw provider:model
 * input) and `invokeShellOrchestrator` (shell-interpolation, post-parse
 * stripped model input).
 *
 * Two gates applied to the input string as-is:
 *   1. **Leading-dash reject.** Blocks shell-option tricks like `--exec`.
 *   2. **Allow-list regex.** `MODEL_NAME_RE` restricts to word chars,
 *      dots, slashes, colons, underscores, and hyphens — covers every
 *      model identifier used in practice (provider-qualified, namespace/
 *      model, ollama quantized tags).
 *
 * Gates 1 + 2 are safe to apply at ANY stage — raw `provider:model` strings
 * and stripped model-portions both pass the same allow-list. The post-parse
 * "model-portion not empty and not dash-prefixed" check (Gate 3) lives
 * inline in `resolveOrchestrator` where the split happens, NOT in this
 * shared helper — applying it to an already-stripped model causes a
 * double-parse that falsely rejects valid names like `foo:-bar` that were
 * safe pre-split (Shield catch on mmnto/totem#1429 GCA round 2).
 *
 * CR catch on mmnto/totem#1429 round 1: exporting only the regex created
 * a drift vector where the shell path could diverge from the config path.
 * This helper closes that vector for the checks that BOTH paths need.
 */
export function assertValidModelName(rawModel: string): void {
  if (rawModel.startsWith('-') || !MODEL_NAME_RE.test(rawModel)) {
    throw new TotemConfigError(
      `Invalid model name '${rawModel}'. Model names may only contain word characters, dots, slashes, colons, underscores, and hyphens, and must not start with a dash.`,
      'Check your orchestrator.model config value and remove any invalid characters.',
      'CONFIG_INVALID',
    );
  }
}

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
  // Shared gates 1 + 2 (regex + leading-dash). Symmetric with the check in
  // `invokeShellOrchestrator` so any model accepted by one path is accepted
  // by the other.
  assertValidModelName(rawModel);

  const parsed = parseModelString(rawModel, baseProvider);

  if (parsed.provider === 'shell' && baseProvider !== 'shell') {
    throw new TotemConfigError(
      `Cannot route to 'shell' provider from a '${baseProvider}' config. The shell provider requires a 'command' template in the orchestrator config.`,
      "Set provider: 'shell' and add a 'command' template in your orchestrator config.",
      'CONFIG_INVALID',
    );
  }

  // Gate 3 — post-parse model-portion check. Applied only here, not in the
  // shared helper, because the helper is also called from the shell-invoke
  // path where the model has already been through parseModelString once.
  // Double-parsing an already-stripped model splits on any embedded `:` a
  // second time and falsely rejects inputs that were safe pre-strip (Shield
  // catch on mmnto/totem#1429).
  if (!parsed.model || parsed.model.startsWith('-')) {
    throw new TotemConfigError(
      `Invalid model name in '${rawModel}'. The model portion must not be empty or start with a hyphen.`,
      'Provide a valid model name after the provider prefix, e.g. "gemini:gemini-2.5-flash-preview-05-20".',
      'CONFIG_INVALID',
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
export const CLI_FALLBACK_COMMANDS: Readonly<Record<string, string>> = {
  gemini: 'gemini -e none -m {model} < {file}',
  anthropic: 'claude -p --model {model} < {file}',
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
    const sdkStartMs = Date.now();
    try {
      return await sdkInvoker(opts);
    } catch (err) {
      const sdkAttempt = failedRuntimeAttempt(
        provider,
        opts.model,
        'sdk',
        Date.now() - sdkStartMs,
        err,
      );
      if (!isFallbackEligible(err)) {
        throw new OrchestratorInvokeError(
          err instanceof Error ? err.message : `Invocation failed for '${provider}'.`,
          sdkAttempt.failureKind ?? 'unknown',
          [sdkAttempt],
          { cause: err },
        );
      }

      if (!(await isCliAvailable(binary))) {
        const cliUnavailable = new Error(`[Totem Error] '${binary}' not found on PATH.`);
        const cliAttempt = failedRuntimeAttempt(
          provider,
          opts.model,
          'cli-fallback',
          0,
          cliUnavailable,
          { spawnFailed: true },
        );
        throw new OrchestratorInvokeError(
          `CLI fallback for '${provider}' unavailable: '${binary}' not found on PATH.`,
          'process-spawn',
          resequenceAttempts([sdkAttempt, cliAttempt]),
          {
            cause: err,
            recoveryHint: `Install the ${provider} CLI or its SDK to use this provider.`,
          },
        );
      }

      const { log } = await import('../ui.js');
      log.warn(opts.tag, `SDK unavailable, falling back to ${binary} CLI...`);
      try {
        const result = await invokeShellOrchestrator({
          ...opts,
          command,
          provider,
          route: 'cli-fallback',
        });
        return {
          ...result,
          attempts: resequenceAttempts([sdkAttempt, ...(result.attempts ?? [])]),
        };
      } catch (fallbackErr) {
        const fallbackAttempts =
          fallbackErr instanceof OrchestratorInvokeError
            ? fallbackErr.attempts
            : [failedRuntimeAttempt(provider, opts.model, 'cli-fallback', 0, fallbackErr)];
        const attempts = resequenceAttempts([sdkAttempt, ...fallbackAttempts]);
        const kind =
          fallbackErr instanceof OrchestratorInvokeError
            ? fallbackErr.kind
            : (attempts.at(-1)?.failureKind ?? 'unknown');
        throw new OrchestratorInvokeError(
          fallbackErr instanceof Error
            ? fallbackErr.message
            : `CLI fallback failed for '${provider}'.`,
          kind,
          attempts,
          { cause: fallbackErr },
        );
      }
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
      return (opts) =>
        invokeShellOrchestrator({
          ...opts,
          command: config.command,
          provider: 'shell',
          route: 'configured-shell',
        });
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
