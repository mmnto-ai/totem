import * as crypto from 'node:crypto';
import * as fs from 'node:fs';

import { canonicalStringify } from './compile-manifest.js';
import { TotemParseError } from './errors.js';

// ─── Public types ────────────────────────────────────

/**
 * Producer attestation inputs for the compile worker. Captured per Proposal 278
 * § Action 3 to make compile-worker drift surfaceable through `verify-manifest`.
 *
 * Honest-disclosure contract: each field reflects what the worker *was
 * configured with* (intent), not what the API *accepted* (reality). The
 * fingerprint records absence (omits the slot) when the configured model
 * rejects a sampling parameter — never a placeholder. Per the proposal's
 * missing-slot tolerance clause.
 */
export interface CompileWorkerFingerprintInputs {
  /** Resolved model ID actually sent to the orchestrator (e.g., `claude-sonnet-4-6`). */
  model: string;
  /**
   * Effective sampling temperature, or `undefined` when the configured model
   * rejects `temperature` (Opus 4.7+) or the caller did not set one. Per
   * `docs/reference/supported-models.md` lines 50-52.
   */
  temperature?: number;
  /**
   * Advisory-only slot — Anthropic does not expose `seed` on the messages
   * API. Reserved for future providers that do (OpenAI, Ollama). Phase 1
   * always emits `undefined` on the anthropic path.
   */
  seed?: number;
  /**
   * sha256 of `packages/cli/src/commands/compile-templates.ts` contents
   * (line-endings normalized to `\n`). Single-file hash chosen per Path A
   * in Proposal 278 § Open Questions — the file is 100% prompt-relevant
   * (KIND_ALLOW_LIST + COMPILER_SYSTEM_PROMPT + PIPELINE3_COMPILER_PROMPT
   * with no orthogonal utility code).
   */
  promptTemplateContentHash: string;
}

// ─── Fingerprint computation ─────────────────────────

/**
 * Deterministic sha256 over canonical JSON of the worker config. Sort-key +
 * undefined-drop semantics from `canonicalStringify` give us the missing-slot
 * tolerance the proposal calls for: an absent `temperature` produces a
 * structurally smaller payload than `temperature: 0`, so the fingerprint
 * differs from a hypothetical "temperature placeholder" alternative.
 */
export function computeCompileWorkerFingerprint(inputs: CompileWorkerFingerprintInputs): string {
  const payload = canonicalStringify(inputs);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

// ─── Prompt-template content hash ────────────────────

/**
 * sha256 of the compile-worker prompt-template file. Line endings normalized
 * to `\n` so the same source produces the same hash across OS boundaries
 * (matches the normalization used by `generateInputHash` /
 * `generateOutputHash`).
 *
 * Throws `TotemParseError` with a recovery hint when the file is missing —
 * fingerprint capture cannot be silent here because a missing template file
 * means the worker is broken at the source, not just the fingerprint.
 */
export function readPromptTemplateContentHash(promptTemplatePath: string): string {
  try {
    const content = fs.readFileSync(promptTemplatePath, 'utf-8').replace(/\r\n/g, '\n');
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (err) {
    // .gemini/styleguide.md § 120 — pass the original error as `cause`, never
    // concatenate `err.message` into the message string (destroys stack
    // traces; `handleError` traverses `.cause` chains automatically).
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new TotemParseError(
        `Cannot hash compile-worker prompt template at ${promptTemplatePath} (file not found)`,
        'The compile-worker prompt template is missing at the resolved path. Reinstall the CLI or verify the build output, depending on whether you are running from source (compile-templates.ts) or a built artifact (compile-templates.js).',
        err,
      );
    }
    throw new TotemParseError(
      `Cannot read compile-worker prompt template at ${promptTemplatePath}`,
      `Check file permissions for ${promptTemplatePath}.`,
      err,
    );
  }
}

// ─── Model-family detection ──────────────────────────

/**
 * True when the model's API rejects the `temperature` (and `top_p` / `top_k`)
 * sampling parameter with HTTP 400. Sourced from
 * `docs/reference/supported-models.md` § Orchestrator Models. Covers:
 *   - Anthropic Opus 4.7+ / Opus 5+ / Sonnet 5+ / Haiku 5+ / Fable / Mythos —
 *     the adaptive-thinking generation removed client sampling control
 *   - OpenAI gpt-5+ reasoning models and the o-series — `temperature` is
 *     unsupported. gpt-5+ *chat* variants (e.g. `gpt-5-chat-latest`) are
 *     excluded: they accept `temperature` while still rejecting the legacy
 *     `max_tokens` key, so the token-key axis is decided separately at the
 *     openai-orchestrator boundary (CR finding on mmnto-ai/totem#2358)
 * Accepts provider-qualified strings ('anthropic:claude-sonnet-5') as well
 * as bare IDs. Consumed by the compile-worker fingerprint (records absence)
 * and by the anthropic/openai orchestrator boundaries (omit the param).
 *
 * Regex is Phase 1 sniff infrastructure — when a provider ships a new family
 * that strips params, widen here. A.3.b's `totem doctor --compliance` is the
 * future home for a richer reconciliation surface; defer until that lands.
 */
export function modelStripsTemperature(model: string): boolean {
  return /opus-4-[7-9]|opus-[5-9]|sonnet-[5-9]|haiku-[5-9]|claude-fable|claude-mythos|gpt-[5-9](?!.*chat)|(?:^|[^a-zA-Z0-9])o[1-9]\d*(?:\D|$)/.test(
    model,
  );
}
