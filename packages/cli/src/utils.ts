import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import dotenv from 'dotenv';

import type {
  BackendAdmissionClass,
  ContextPolicy,
  CustomSecret,
  GroundingBundle,
  Orchestrator,
  OutputContract,
  RunArtifact,
  RunMetadata,
  SearchResult,
  TotemConfig,
} from '@mmnto/totem';
import {
  ADMISSION_COMPLETION_ONLY,
  buildGroundingBundle,
  calculateDeterministicHash,
  CONFIG_FILES,
  maskSecrets,
  RUN_ARTIFACT_SCHEMA_VERSION,
  saveRunArtifact,
  TotemConfigError,
  TotemConfigSchema,
  TotemOrchestratorError,
} from '@mmnto/totem';

import type { OrchestratorResult } from './orchestrators/orchestrator.js';
import { createOrchestrator, resolveOrchestrator } from './orchestrators/orchestrator.js';
import { bold, log } from './ui.js';

// ─── Shared constants ────────────────────────────────────

const TELEMETRY_FILE = 'telemetry.jsonl';

/** execFileSync on Windows can't resolve executables without `shell: true`. */
export const IS_WIN = process.platform === 'win32';

/** Timeout for GitHub CLI calls (ms). */
export const GH_TIMEOUT_MS = 15_000;

/**
 * Load environment variables from .env file (does not override existing).
 * Uses the `dotenv` library for robust parsing of inline comments, quoted
 * values containing `#`, and other edge cases.
 */
export function loadEnv(cwd: string): void {
  const envPath = path.join(cwd, '.env');
  if (!fs.existsSync(envPath)) return;

  dotenv.config({ path: envPath });
}

// Re-export from core — canonical list of config file names
export { CONFIG_FILES };

export type ConfigFormat = 'ts' | 'yaml' | 'toml';

/** Return the global totem directory path (~/.totem/). Accepts override for testing. */
export function getGlobalTotemDir(homeDir?: string): string {
  return path.join(homeDir ?? os.homedir(), '.totem');
}

/**
 * Resolve config path by checking the fallback chain: .ts → .yaml → .yml → .toml
 * Falls back to the global ~/.totem/ profile when no local config exists.
 */
export function resolveConfigPath(cwd: string, homeDir?: string): string {
  // 1. Check CWD for local config
  for (const file of CONFIG_FILES) {
    const candidate = path.join(cwd, file);
    if (fs.existsSync(candidate)) return candidate;
  }

  // 2. Check global ~/.totem/ profile
  const globalTotemDir = getGlobalTotemDir(homeDir);
  for (const file of CONFIG_FILES) {
    const candidate = path.join(globalTotemDir, file);
    if (fs.existsSync(candidate)) return candidate;
  }

  // 3. Neither found — error with updated hint
  throw new TotemConfigError(
    'No Totem configuration found.',
    "Run 'totem init' to create a project config, or 'totem init --global' for a personal profile.",
    'CONFIG_MISSING',
  );
}

/** Check whether a resolved config path comes from the global ~/.totem/ profile. */
export function isGlobalConfigPath(configPath: string, homeDir?: string): boolean {
  const globalTotemDir = getGlobalTotemDir(homeDir);
  const normalizedGlobal = path.normalize(globalTotemDir) + path.sep;
  return path.normalize(configPath).startsWith(normalizedGlobal);
}

/**
 * Load and validate Totem configuration from any supported format.
 * Routes parsing by file extension: .ts via jiti, .yaml/.yml via yaml, .toml via smol-toml.
 */
export async function loadConfig(configPath: string): Promise<TotemConfig> {
  const ext = path.extname(configPath).toLowerCase();

  let raw: unknown;
  try {
    if (ext === '.ts') {
      const { createJiti } = await import('jiti');
      const jiti = createJiti(import.meta.url);
      const mod = (await jiti.import(configPath)) as Record<string, unknown>;
      raw = mod['default'] ?? mod;
    } else if (ext === '.yaml' || ext === '.yml') {
      const { parse } = await import('yaml');
      const content = fs.readFileSync(configPath, 'utf-8');
      raw = parse(content);
    } else if (ext === '.toml') {
      const { parse } = await import('smol-toml');
      const content = fs.readFileSync(configPath, 'utf-8');
      raw = parse(content);
    } else {
      throw new TotemConfigError(
        `Unsupported config format: ${ext}`,
        'Use totem.config.ts, totem.yaml, totem.yml, or totem.toml.',
        'CONFIG_INVALID',
      );
    }
  } catch (err) {
    // Re-throw TotemErrors as-is
    if (err instanceof TotemConfigError) throw err;
    // Wrap parse errors with file context
    const msg = err instanceof Error ? err.message : String(err);
    throw new TotemConfigError(
      `Failed to parse ${path.basename(configPath)}: ${msg}`,
      'Check the file for syntax errors.',
      'CONFIG_INVALID',
      err,
    );
  }

  try {
    return TotemConfigSchema.parse(raw);
  } catch (err) {
    // Format Zod errors into clean, human-readable messages
    if (err instanceof Error && err.name === 'ZodError' && 'issues' in err) {
      const issues = (err as { issues: Array<{ path: string[]; message: string }> }).issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new TotemConfigError(
        `Invalid configuration in ${path.basename(configPath)}:\n${issues}`,
        'Fix the fields listed above. See docs for the config schema.',
        'CONFIG_INVALID',
        err,
      );
    }
    throw err;
  }
}

// Re-export from core — unified embedding guard (#187)
export { requireEmbedding } from '@mmnto/totem';

// ─── Telemetry ──────────────────────────────────────────

interface TelemetryEntry {
  timestamp: string;
  tag: string;
  model: string;
  promptChars: number;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
}

function appendTelemetry(entry: TelemetryEntry, cwd: string, totemDir: string): void {
  try {
    const tempDir = path.join(cwd, totemDir, 'temp');
    fs.mkdirSync(tempDir, { recursive: true });
    fs.appendFileSync(path.join(tempDir, TELEMETRY_FILE), JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err) {
    // Telemetry is best-effort — never block the command, but warn on failure
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('Totem', `Failed to write telemetry: ${msg}`);
  }
}

// ─── Orphaned temp file cleanup ──────────────────────────

const TEMP_FILE_RE = /^totem-.*\.md$/;
const TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Reap orphaned temp files older than `maxAgeMs` from `.totem/temp/`.
 * Fire-and-forget — never blocks the CLI critical path.
 */
export async function reapOrphanedTempFiles(
  cwd: string,
  totemDir: string,
  maxAgeMs: number = TEMP_MAX_AGE_MS,
): Promise<number> {
  const tempDir = path.join(cwd, totemDir, 'temp');
  const { readdir, stat, unlink } = fs.promises;

  let entries: string[];
  try {
    entries = await readdir(tempDir);
  } catch {
    return 0; // Directory doesn't exist yet — nothing to clean
  }

  let removed = 0;
  const now = Date.now();

  for (const entry of entries) {
    if (!TEMP_FILE_RE.test(entry)) continue;

    const filePath = path.join(tempDir, entry);
    try {
      const info = await stat(filePath);
      if (now - info.mtimeMs > maxAgeMs) {
        await unlink(filePath);
        removed++;
      }
    } catch {
      // ENOENT (race), EACCES/EPERM (permissions) — swallow silently
    }
  }

  return removed;
}

// ─── System prompt overrides ─────────────────────────────

const SAFE_COMMAND_NAME_RE = /^[a-z][a-z0-9_-]{0,30}$/;

/**
 * Load a custom system prompt from `.totem/prompts/<commandName>.md` if it exists.
 * Falls back to the built-in default prompt when the file is missing, empty, or unreadable.
 */
export function getSystemPrompt(
  commandName: string,
  defaultPrompt: string,
  cwd: string,
  totemDir: string,
): string {
  if (!SAFE_COMMAND_NAME_RE.test(commandName)) return defaultPrompt;

  const promptPath = path.join(cwd, totemDir, 'prompts', `${commandName}.md`);
  if (!fs.existsSync(promptPath)) return defaultPrompt;

  try {
    const content = fs.readFileSync(promptPath, 'utf-8');
    if (!content.trim()) return defaultPrompt;
    return content;
  } catch {
    return defaultPrompt;
  }
}

// ─── Output helpers ─────────────────────────────────────

export function writeOutput(content: string, outPath?: string): void {
  if (outPath) {
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outPath, content, 'utf-8');
  } else {
    console.log(content);
  }
}

// ─── Terminal sanitization ───────────────────────────────

// Re-export from core — shared between CLI and MCP (#207)
export { sanitize } from '@mmnto/totem';

// ─── XML delimiting ─────────────────────────────────────

// Re-export from core — unified XML escaping (#158)
export { wrapUntrustedXml, wrapXml } from '@mmnto/totem';

// ─── Glob matching ──────────────────────────────────────

// Re-export from core — shared glob semantics so CLI command modules avoid a
// static top-level barrel import of '@mmnto/totem' (heavy-deps-at-startup rule,
// mmnto-ai/totem#2339). Used by the review generated-artifact classifier (#2398).
export { matchesGlob } from '@mmnto/totem';

// ─── Context formatting ─────────────────────────────────

const MAX_RESULT_CONTENT_LENGTH = 300;
const CONDENSED_CONTENT_LENGTH = 80;

export function formatResults(
  results: SearchResult[],
  heading: string,
  condensed?: boolean,
): string {
  if (results.length === 0) return '';
  const maxLen = condensed ? CONDENSED_CONTENT_LENGTH : MAX_RESULT_CONTENT_LENGTH;
  const items = results
    .map((r) => {
      const ellipsis = r.content.length > maxLen ? '...' : '';
      const truncated = r.content.slice(0, maxLen);

      if (condensed) {
        const snippet = truncated.replace(/\n/g, ' ');
        return `- **${r.label}** (${r.filePath}) ${snippet}${ellipsis}`;
      }

      const snippet = truncated.replace(/\n/g, '\n  ');
      return (
        `- **${r.label}** (${r.filePath}, score: ${r.score.toFixed(3)})\n  ` +
        `${snippet}${ellipsis}`
      );
    })
    .join('\n\n');
  return `\n=== ${heading} ===\n${items}\n`;
}

// ─── Lesson formatting ───────────────────────────────────

/** Default character budget for lesson sections across orchestrator commands. */
export const DEFAULT_MAX_LESSON_CHARS = 8_000;

/**
 * Partition search results into lessons (from lessons.md) and non-lesson specs.
 */
export function partitionLessons(
  allSpecs: SearchResult[],
  maxLessons: number,
  maxSpecs: number,
): { lessons: SearchResult[]; specs: SearchResult[] } {
  const lessons = allSpecs.filter((r) => r.type === 'lesson').slice(0, maxLessons);
  const specs = allSpecs.filter((r) => r.type !== 'lesson').slice(0, maxSpecs);
  return { lessons, specs };
}

/** Max content length for condensed lesson snippets. */
const CONDENSED_LESSON_LENGTH = 120;

/**
 * Format lessons as a prompt section with character budgeting.
 * Use `condensed` for high-frequency commands (triage) to save tokens.
 * Returns empty string if no lessons fit within the budget.
 */
export function formatLessonSection(
  lessons: SearchResult[],
  maxChars: number = DEFAULT_MAX_LESSON_CHARS,
  condensed?: boolean,
): string {
  if (lessons.length === 0) return '';

  const lessonLines: string[] = [];
  let charBudget = maxChars;
  for (const lesson of lessons) {
    let entry: string;
    if (condensed) {
      const snippet = lesson.content.slice(0, CONDENSED_LESSON_LENGTH).replace(/\n/g, ' ');
      const ellipsis = lesson.content.length > CONDENSED_LESSON_LENGTH ? '...' : '';
      entry = `- **${lesson.label}** ${snippet}${ellipsis}`;
    } else {
      entry = `- **${lesson.label}** (score: ${lesson.score.toFixed(3)})\n  ${lesson.content.replace(/\n/g, '\n  ')}`;
    }
    if (entry.length > charBudget) continue;
    lessonLines.push(entry);
    charBudget -= entry.length;
  }

  if (lessonLines.length === 0) return '';
  return `\n=== RELEVANT LESSONS (HARD CONSTRAINTS) ===\n${lessonLines.join('\n\n')}\n`;
}

// ─── Orchestrator runner ─────────────────────────────────

export interface OrchestratorRunOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
}

const DEFAULT_TTLS: Record<string, number> = {
  triage: 3600, // 1 hour
  spec: 3600, // 1 hour
  docs: 0, // No cache, each run should reflect latest state
  shield: 0,
  learn: 0,
};

/**
 * The admission-contract fields that participate in the response-cache key
 * (mmnto-ai/totem#2102, #2148 round-1): two calls differing solely in these
 * fields must never alias to one cached payload. `groundingBundle` is the
 * RECONCILED bundle (the transported identity), not just `opts.groundingBundle`.
 */
interface ResponseCacheContract {
  groundingBundle?: GroundingBundle;
  backendAdmissionClass?: BackendAdmissionClass;
  outputContract?: OutputContract;
  contextPolicy?: ContextPolicy;
  runMetadata?: RunMetadata;
}

/**
 * Build the response-cache key for the orthogonal command-level cache (#52).
 *
 * Hashes prompt, systemPrompt, and the qualifiedModel string with `\0` byte
 * delimiters between every field so boundary-case inputs (e.g. `prompt="AB",
 * systemPrompt=""` vs `prompt="A", systemPrompt="B"`) produce distinct keys.
 *
 * When at least one admission-contract field is present (mmnto-ai/totem#2148
 * round-1), a deterministic serialization of the contract joins the hash
 * input so calls differing only in contract fields key separately. When
 * every field is absent the hash input is BYTE-IDENTICAL to the legacy shape
 * — invariant 1 (the mmnto/totem#1291 additive precedent): legacy callers'
 * cache entries stay warm.
 *
 * Used by both the read path (lookup) and write path (store) inside
 * `runOrchestrator` to guarantee the keys are identical — extracted as a
 * pure helper after the mmnto/totem#1292 review (mmnto/totem#1291) caught a
 * regression where my Phase 3 cascade fix updated only the read path,
 * leaving the write path on the legacy `prompt + model` shape and making
 * fresh cache entries unreachable on subsequent runs.
 */
function buildResponseCacheHash(
  prompt: string,
  systemPrompt: string | undefined,
  qualifiedModel: string,
  contract?: ResponseCacheContract,
): string {
  const hash = crypto
    .createHash('sha256')
    .update(prompt)
    .update('\0')
    .update(systemPrompt ?? '')
    .update('\0')
    .update(qualifiedModel);
  // Conditional spreads: an absent field contributes NO key, so the
  // all-absent contract is an empty object and the legacy branch below.
  const contractFields = {
    ...(contract?.groundingBundle !== undefined
      ? { groundingBundleHash: calculateDeterministicHash(contract.groundingBundle) }
      : {}),
    ...(contract?.backendAdmissionClass !== undefined
      ? { backendAdmissionClass: contract.backendAdmissionClass }
      : {}),
    ...(contract?.outputContract !== undefined ? { outputContract: contract.outputContract } : {}),
    ...(contract?.contextPolicy !== undefined ? { contextPolicy: contract.contextPolicy } : {}),
    ...(contract?.runMetadata !== undefined ? { runMetadata: contract.runMetadata } : {}),
  };
  if (Object.keys(contractFields).length > 0) {
    // calculateDeterministicHash is key-order independent — the same identity
    // primitive the artifacts use, so the serialization is deterministic.
    hash.update('\0').update(calculateDeterministicHash(contractFields));
  }
  return hash.digest('hex').slice(0, 16);
}

/**
 * Caller-supplied context for grounded run-artifact emission
 * (mmnto-ai/totem#2100). STRICTLY additive: callers that omit `artifact`
 * observe byte-identical `runOrchestrator` behavior — the #2106 constraint
 * (12 call sites compile untouched; spec/review migrate first).
 *
 * The caller supplies what only it knows (its grounding context + how that
 * context was assembled); `runOrchestrator` supplies what only IT knows (the
 * post-DLP masked prompt, the post-quota-fallback resolved backend, the
 * `OrchestratorResult` metrics that never leave this function).
 */
export interface RunArtifactRequest {
  /** Deterministic hash of the grounding surface — `calculateDeterministicHash(bundle)` when a bundle is supplied (mmnto-ai/totem#2101). */
  groundingHash: string;
  /** Derived class-count summary (`summarizeProvenance(bundle)`) when a bundle is supplied; explicit string otherwise (bundle-less reruns of slice-1 artifacts). */
  provenanceSummary: string;
  /**
   * Per-item provenance record (mmnto-ai/totem#2101), recorded verbatim into
   * `grounding.bundle`. Optional ONLY for reruns of slice-1 artifacts, which
   * carry their original grounding identity and have no bundle to forge.
   */
  bundle?: GroundingBundle;
  /** Deterministic diff input when the run was scoped (`lint/review --branch`, #2098). */
  diffScope?: string;
  /** The grounded spec contract, when the run senses against one. */
  specContract?: string;
  /** Fires after a successful write (or dedup hit) with the content address + path. */
  onEmitted?: (hash: string, artifactPath: string) => void;
}

/** The identity-relevant subset of a retrieval hit — what the bundle records. */
type RetrievalItem = Pick<SearchResult, 'content' | 'filePath' | 'sourceRepo'>;

/**
 * Assemble the grounding bundle for the spec/review retrieval shape
 * (mmnto-ai/totem#2101): every partition's items enter under their partition
 * as `sourceType`, classed `similarity-only` by the core builder. Shared by
 * both callers so the retrieval→bundle mapping has ONE enumeration — a
 * caller-local copy that drifted would silently drop a partition from the
 * provenance record.
 */
export function buildRetrievalGroundingBundle(context: {
  specs: RetrievalItem[];
  sessions: RetrievalItem[];
  code: RetrievalItem[];
  lessons: RetrievalItem[];
}): GroundingBundle {
  return buildGroundingBundle([
    ...context.specs.map((result) => ({ sourceType: 'spec', result })),
    ...context.sessions.map((result) => ({ sourceType: 'session_log', result })),
    ...context.code.map((result) => ({ sourceType: 'code', result })),
    ...context.lessons.map((result) => ({ sourceType: 'lesson', result })),
  ]);
}

// ─── Code-blind grounding guard (mmnto-ai/totem#2106, strategy#474) ──
//
// Interim fail-loud guard for `spec`/`review`: when retrieval returns ZERO code
// chunks, the LLM has no code grounding to verify any file/type/system claim
// against — the lc#463 class where the tool confabulated a whole architecture.
// Per the strategy#474 interim ruling this DEGRADES, it does NOT disable: a
// deterministic, advisory banner is surfaced and a suppression directive is
// folded into the system prompt so the model stays at the altitude the
// retrieved specs/sessions/lessons support. The banner is the Tenet-4
// guarantee (code-emitted, LLM-independent); the directive is best-effort.
// Keyed strictly on `code` — independent of specs/sessions/lessons.

/**
 * User-facing notice surfaced on the 0-code path. Advisory-neutral by design
 * (strategy#474 Q2): a broad/new-area `spec` can legitimately retrieve 0 code,
 * so this must read as a caveat, not a hard failure.
 */
export const CODE_BLIND_BANNER =
  'No code context retrieved — architecture claims are unverified against the codebase. Treat any file, type, or system specifics as unconfirmed assumptions, not facts.';

/**
 * Directive folded into the system prompt on the 0-code path so the model
 * degrades instead of confabulating. Soft (LLM-side) by design — the banner
 * carries the deterministic guarantee.
 */
export const CODE_BLIND_PROMPT_DIRECTIVE = [
  '=== GROUNDING NOTICE: NO CODE RETRIEVED ===',
  'Zero code was retrieved from the knowledge index for this run — you have NO grounding to verify code specifics against.',
  'Do NOT assert the existence of specific files, types, classes, functions, modules, or directory layouts; you cannot confirm them.',
  'Stay at the altitude the retrieved specs, sessions, and lessons actually support, and mark any architectural specifics as UNVERIFIED ASSUMPTIONS rather than established facts.',
].join('\n');

/**
 * True when retrieval returned zero code chunks — the 0-code grounding signal
 * (mmnto-ai/totem#2106). Keyed strictly on `code`, independent of
 * specs/sessions/lessons.
 */
export function isCodeBlind(context: { code: readonly unknown[] }): boolean {
  return context.code.length === 0;
}

export interface CodeBlindGuardResult {
  /** Whether the 0-code guard fired. */
  codeBlind: boolean;
  /** System prompt to use: directive-augmented when `codeBlind`, else unchanged. */
  systemPrompt: string;
  /** User-facing banner — present iff `codeBlind`. */
  banner?: string;
}

/**
 * Apply the code-blind grounding guard for a `spec`/`review` run. Pure and
 * total: never throws, never disables — the command always proceeds. Callers
 * emit `banner` (when present) to their surface and pass `systemPrompt` on to
 * prompt assembly.
 */
export function applyCodeBlindGuard(
  context: { code: readonly unknown[] },
  systemPrompt: string,
): CodeBlindGuardResult {
  if (!isCodeBlind(context)) {
    return { codeBlind: false, systemPrompt };
  }
  return {
    codeBlind: true,
    systemPrompt: `${systemPrompt}\n\n${CODE_BLIND_PROMPT_DIRECTIVE}`,
    banner: CODE_BLIND_BANNER,
  };
}

/**
 * Admission gate (mmnto-ai/totem#2102, strategy#474 slice 3): a requested
 * class above `completion_only` must be declared in
 * `orchestrator.capabilities.admissionClasses`. The declaration is
 * CONFIG-LEVEL — scoped to the base provider — so this check alone is not
 * per-resolved-backend: `resolveOrchestrator` can route a provider-qualified
 * model (primary or fallback) to a different provider. It is therefore
 * paired with a cross-provider denial on BOTH paths (mmnto-ai/totem#2148
 * round-1 added the primary's): an elevated class whose resolved provider differs from the
 * base config's fails loud. Together they decide admission per RESOLVED
 * backend before EACH invoke, BEFORE any tokens are spent — a denied run
 * emits no artifact. Declaration is a capability claim only; output
 * enforcement is caller-side (mmnto-ai/totem#2103).
 */
function assertAdmissionDeclared(
  requested: BackendAdmissionClass,
  orchestrator: Orchestrator,
): void {
  if (requested === ADMISSION_COMPLETION_ONLY) return;
  // Absent declaration = ['completion_only'] — factually true of every backend today.
  const declared = orchestrator.capabilities?.admissionClasses ?? [ADMISSION_COMPLETION_ONLY];
  if (!declared.includes(requested)) {
    throw new TotemConfigError(
      `Admission denied: requested backend admission class '${requested}' is not declared in orchestrator.capabilities.admissionClasses.`,
      "Declare the class in your orchestrator config (capabilities: { admissionClasses: ['self_grounding_agent'] }) or drop the backendAdmissionClass request.",
      'CONFIG_INVALID',
    );
  }
}

/**
 * Validate orchestrator config, then either output raw context (--raw) or
 * invoke the configured orchestrator provider and return the LLM content.
 *
 * Returns `undefined` in --raw mode (prompt already written to output).
 * Returns the LLM response content string otherwise.
 * Callers are responsible for writing output via `writeOutput()`.
 */
export async function runOrchestrator(opts: {
  prompt: string;
  /**
   * Optional persistent system context that providers MAY cache server-side
   * (mmnto/totem#1291 Phase 3). When set AND the orchestrator config has
   * `enableContextCaching: true`, providers like Anthropic mark this segment
   * with `cache_control: { type: 'ephemeral' }` so subsequent calls within
   * the TTL window read from prompt cache at ~10% the input-token cost.
   */
  systemPrompt?: string;
  tag: string;
  options: OrchestratorRunOptions;
  config: TotemConfig;
  cwd: string;
  /** Absolute path to the directory containing totem.config.* — used for cache paths instead of cwd */
  configRoot?: string;
  totalResults?: number;
  temperature?: number;
  /** User-defined custom secrets to redact via DLP before outbound LLM calls (#921). */
  customSecrets?: CustomSecret[];
  /**
   * Opt-in grounded run-artifact emission (mmnto-ai/totem#2100). When set, a
   * successful ACTUAL invoke (never a response-cache hit) appends an immutable
   * content-addressed record under `<totemDir>/artifacts/runs/`. Emission
   * failure warns and never fails the run. Omitted = today's behavior.
   */
  artifact?: RunArtifactRequest;

  // ─── Admission contract (mmnto-ai/totem#2102, strategy#474 slice 3) ──
  // All six are optional and defaulted through the existing surfaces, so
  // omitting every one is byte-identical to today (#1291 additive precedent).

  /** Neutral task identity — records to `backend.taskProfile` as `task ?? tag` (`tag` stays the UI/cache/TTL key). */
  task?: string;
  /**
   * The delivered grounding identity, reconciled with `artifact.bundle`:
   * one supplied serves both roles; both supplied must hash-agree, else a
   * hard ambiguous-grounding-identity error before any invoke.
   */
  groundingBundle?: GroundingBundle;
  /** Requested admission class — gated against `orchestrator.capabilities.admissionClasses` before EACH invoke. Defaults to `completion_only`. */
  backendAdmissionClass?: BackendAdmissionClass;
  /** Advisory context policy (budget unit: input tokens) — recorded into the artifact `admission` group. */
  contextPolicy?: ContextPolicy;
  /** Caller-declared output contract — recorded; #2103 post-checks enforce. */
  outputContract?: OutputContract;
  /** Caller identity metadata — recorded verbatim into the artifact `admission` group. */
  runMetadata?: RunMetadata;
}): Promise<string | undefined> {
  const { prompt, systemPrompt, tag, options, config, cwd } = opts;
  const configRoot = opts.configRoot ?? cwd;

  // --raw mode: output context only.
  // mmnto/totem#1291 Phase 3: when systemPrompt is set (post-split callers like
  // compile-lesson), concatenate both segments in the raw artifact so the
  // file accurately reflects what the model would receive. Pre-split callers
  // that pass only `prompt` get today's behavior unchanged.
  //
  // Plain `${systemPrompt}\n\n${prompt}` concatenation matches the established
  // pattern in shell-orchestrator.ts (CLI binaries have no structured message
  // API and the orchestrator concatenates before piping), and avoids any
  // markdown-marker text that downstream consumers might misinterpret as
  // content when piping the raw output to other tools or LLMs. CodeRabbit
  // initially asked for the markers in mmnto/totem#1292 round 1; GCA pushed back
  // in round 2 for the pipe-safety reason. The shell precedent + pipe-safety
  // wins.
  if (options.raw) {
    const rawOutput =
      systemPrompt !== undefined && systemPrompt.length > 0
        ? `${systemPrompt}\n\n${prompt}`
        : prompt;
    writeOutput(rawOutput, options.out);
    const suffix = opts.totalResults != null ? ` (${opts.totalResults} chunks)` : '';
    log.dim(tag, `Raw context output complete${suffix}.`);
    return undefined;
  }

  // Require orchestrator for LLM synthesis
  if (!config.orchestrator) {
    throw new TotemConfigError(
      'No orchestrator configured.',
      "Add an 'orchestrator' block to totem.config.ts.\n" +
        "Example:\n  orchestrator: {\n    provider: 'shell',\n    command: 'gemini --model {model} -e none < {file}',\n    defaultModel: 'gemini-2.5-pro',\n  }",
      'CONFIG_INVALID',
    );
  }

  // ── Grounding identity reconciliation (mmnto-ai/totem#2102) ──
  // One identity, two seams: when both are supplied they must agree; when
  // only one is supplied it serves both roles (invoke-seam transport +
  // artifact record).
  if (
    opts.groundingBundle !== undefined &&
    opts.artifact?.bundle !== undefined &&
    calculateDeterministicHash(opts.groundingBundle) !==
      calculateDeterministicHash(opts.artifact.bundle)
  ) {
    throw new TotemConfigError(
      'Ambiguous grounding identity: groundingBundle and artifact.bundle were both supplied with mismatched deterministic hashes.',
      'Supply only one of the two, or make them agree.',
      'CONFIG_INVALID',
    );
  }
  // mmnto-ai/totem#2148 round-1, VERIFY-AND-REJECT (never recompute — this seam records,
  // never re-derives): when the artifact's bundle role is adopted from
  // `opts.groundingBundle` (no `artifact.bundle` supplied), the caller-attested
  // `artifact.groundingHash` must recompute from that adopted bundle —
  // otherwise the artifact would persist a grounding.hash that does not match
  // its recorded grounding.bundle.
  if (
    opts.artifact !== undefined &&
    opts.groundingBundle !== undefined &&
    opts.artifact.bundle === undefined &&
    calculateDeterministicHash(opts.groundingBundle) !== opts.artifact.groundingHash
  ) {
    throw new TotemConfigError(
      'Ambiguous grounding identity: artifact.groundingHash does not match the deterministic hash of the adopted groundingBundle.',
      'Supply artifact.groundingHash as calculateDeterministicHash(groundingBundle), or make them agree.',
      'CONFIG_INVALID',
    );
  }
  const groundingBundle = opts.groundingBundle ?? opts.artifact?.bundle;

  // #2102: caller-supplied wins over the defaults; the defaults reproduce
  // today's behavior exactly (taskProfile = tag, class = completion_only).
  const requestedAdmissionClass = opts.backendAdmissionClass ?? ADMISSION_COMPLETION_ONLY;
  const taskProfile = opts.task ?? tag;

  // mmnto-ai/totem#2148 round-1: the contract fields participating in the response-cache
  // key. Built ONCE from the caller-supplied (not defaulted) values plus the
  // reconciled bundle, and passed to BOTH the read and write paths so the
  // keys stay identical. All-absent = empty object = legacy key (invariant 1).
  const cacheContract: ResponseCacheContract = {
    ...(groundingBundle !== undefined ? { groundingBundle } : {}),
    ...(opts.backendAdmissionClass !== undefined
      ? { backendAdmissionClass: opts.backendAdmissionClass }
      : {}),
    ...(opts.outputContract !== undefined ? { outputContract: opts.outputContract } : {}),
    ...(opts.contextPolicy !== undefined ? { contextPolicy: opts.contextPolicy } : {}),
    ...(opts.runMetadata !== undefined ? { runMetadata: opts.runMetadata } : {}),
  };

  const baseProvider = config.orchestrator.provider;
  const baseInvoke = createOrchestrator(config.orchestrator);

  const tagKey = tag.toLowerCase();
  const rawModel =
    options.model ?? config.orchestrator.overrides?.[tagKey] ?? config.orchestrator.defaultModel;
  if (!rawModel) {
    throw new TotemConfigError(
      'No model specified.',
      "Provide one with --model, set a command-specific model in 'overrides', or set a 'defaultModel' in your orchestrator config.",
      'CONFIG_INVALID',
    );
  }

  let resolved = resolveOrchestrator(rawModel, baseProvider, baseInvoke);
  let model = resolved.parsed.model;
  let qualifiedModel = resolved.qualifiedModel;
  let invoke = resolved.invoke;

  // ── Admission gate, primary path (mmnto-ai/totem#2102) ──
  // Decided per RESOLVED backend BEFORE the invoke (and before the response
  // cache: a denied class must not be served a replay either). No tokens are
  // spent and no artifact is emitted for a denied run.
  assertAdmissionDeclared(requestedAdmissionClass, config.orchestrator);
  // mmnto-ai/totem#2148 round-1: `resolveOrchestrator` can route a provider-qualified
  // PRIMARY model to a DIFFERENT provider than the base config, and the
  // capability declaration is config-level (base-provider scoped) — so an
  // elevated class that passed the declaration check must still be denied
  // when the primary resolves cross-provider, same conservative slice-3 rule
  // as the quota-fallback path below. Per-provider capability declarations
  // are the future relaxation.
  if (
    requestedAdmissionClass !== ADMISSION_COMPLETION_ONLY &&
    resolved.parsed.provider !== baseProvider
  ) {
    throw new TotemConfigError(
      `Admission denied: model '${rawModel}' resolves to provider '${resolved.parsed.provider}' (base config: '${baseProvider}') while admission class '${requestedAdmissionClass}' is requested — cross-provider routing is not admitted above '${ADMISSION_COMPLETION_ONLY}' until per-provider capability declarations exist.`,
      'Use a model on the base provider, or drop the elevated backendAdmissionClass request.',
      'CONFIG_INVALID',
    );
  }

  log.info(tag, `Model: ${bold(rawModel)}`);

  const ttlSeconds = config.orchestrator.cacheTtls?.[tagKey] ?? DEFAULT_TTLS[tagKey] ?? 0;
  const useCache = ttlSeconds > 0 && !options.fresh;
  let cachePath = '';

  if (useCache) {
    const hash = buildResponseCacheHash(prompt, systemPrompt, qualifiedModel, cacheContract);
    const cacheDir = path.join(configRoot, config.totemDir, 'cache');
    cachePath = path.join(cacheDir, `${tagKey}-${hash}.json`);

    if (fs.existsSync(cachePath)) {
      try {
        const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        const ageMs = Date.now() - cacheData.timestamp;
        if (ageMs < ttlSeconds * 1000) {
          log.dim(tag, `Result loaded from cache (TTL: ${ttlSeconds}s)`);
          if (opts.artifact !== undefined) {
            // mmnto-ai/totem#2100: artifacts record ACTUAL invokes. A cached
            // response is a replay of an already-recorded run, not new ground
            // truth — emitting here would forge a run that never happened.
            log.dim(tag, 'Response cache hit — no run artifact emitted.');
          }
          return cacheData.content;
        }
      } catch {
        // Ignore cache read errors
      }
    }
  }

  // DLP middleware: mask secrets before any outbound LLM call (#strategy-12)
  const baseUrl =
    'baseUrl' in config.orchestrator && typeof config.orchestrator.baseUrl === 'string'
      ? config.orchestrator.baseUrl
      : undefined;
  const LOCAL_HOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i;
  const isLocalProvider =
    (config.orchestrator.provider === 'ollama' &&
      (baseUrl == null || LOCAL_HOST_RE.test(baseUrl))) ||
    (baseUrl != null && LOCAL_HOST_RE.test(baseUrl));
  let safePrompt = prompt;
  // mmnto/totem#1291 Phase 3: scrub the systemPrompt too. Today's only
  // caller (compile.ts) passes a static developer-authored template with no
  // user data, but future call sites might inject runtime context, so we
  // mask it on the same path as the user prompt.
  let safeSystemPrompt = systemPrompt;
  if (!isLocalProvider) {
    try {
      safePrompt = maskSecrets(prompt, opts.customSecrets);
      if (safePrompt !== prompt) {
        log.warn(tag, 'DLP: secrets detected and redacted before LLM call');
      }
      if (systemPrompt !== undefined) {
        safeSystemPrompt = maskSecrets(systemPrompt, opts.customSecrets);
        if (safeSystemPrompt !== systemPrompt) {
          log.warn(tag, 'DLP: secrets detected in systemPrompt and redacted before LLM call');
        }
      }
    } catch (err) {
      throw new TotemOrchestratorError(
        `DLP scan failed: ${err instanceof Error ? err.message : String(err)}`,
        'DLP masking is mandatory for remote providers. Fix the error or use a local provider.',
        err,
      );
    }
  }

  // mmnto/totem#1291 Phase 3: read prompt-cache opts from orchestrator config
  // so they can flow through to provider implementations that support caching
  // (Anthropic in 1.15.0; Gemini deferred to 1.16.0). Both fields are optional
  // and undefined-safe — providers fall back to today's behavior when unset.
  const enableContextCaching = config.orchestrator.enableContextCaching;
  const cacheTTL = config.orchestrator.cacheTTL;

  // #2102 transport: thread the adopted field names verbatim when supplied.
  // Conditional spreads keep the omit-everything invoke payload byte-identical
  // to today (#1291 additive precedent, invariant 1). Providers transport
  // these, never read them this slice.
  const admissionTransport = {
    ...(opts.task !== undefined ? { task: opts.task } : {}),
    ...(groundingBundle !== undefined ? { groundingBundle } : {}),
    ...(opts.backendAdmissionClass !== undefined
      ? { backendAdmissionClass: opts.backendAdmissionClass }
      : {}),
    ...(opts.contextPolicy !== undefined ? { contextPolicy: opts.contextPolicy } : {}),
    ...(opts.outputContract !== undefined ? { outputContract: opts.outputContract } : {}),
    ...(opts.runMetadata !== undefined ? { runMetadata: opts.runMetadata } : {}),
  };

  let result: OrchestratorResult;
  try {
    result = await invoke({
      prompt: safePrompt,
      ...(safeSystemPrompt !== undefined ? { systemPrompt: safeSystemPrompt } : {}),
      model,
      cwd,
      tag,
      totemDir: config.totemDir,
      temperature: opts.temperature,
      ...(enableContextCaching !== undefined ? { enableContextCaching } : {}),
      ...(cacheTTL !== undefined ? { cacheTTL } : {}),
      ...admissionTransport,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'QuotaError') {
      const rawFallback = config.orchestrator.fallbackModel;
      if (rawFallback && rawModel !== rawFallback) {
        log.warn(
          tag,
          `Quota exhausted for ${rawModel}. Retrying with fallback model: ${bold(rawFallback)}...`,
        );
        const fallbackResolved = resolveOrchestrator(rawFallback, baseProvider, baseInvoke);

        // ── Admission gate, fallback path (mmnto-ai/totem#2102) ──
        // `resolveOrchestrator` can route a provider-qualified fallbackModel
        // to a DIFFERENT provider, and a single config-level declaration
        // cannot honestly cover backends with different real capabilities.
        // Slice-3 rule, conservative and deterministic: an elevated class
        // admits the fallback only when it resolves to the SAME provider as
        // the primary — cross-provider fails loud BEFORE the fallback invoke,
        // reporting the primary and admission errors together. Per-provider
        // capability declarations are the future relaxation.
        if (
          requestedAdmissionClass !== ADMISSION_COMPLETION_ONLY &&
          fallbackResolved.parsed.provider !== resolved.parsed.provider
        ) {
          throw new TotemOrchestratorError(
            `Primary model '${rawModel}' failed and the quota fallback '${rawFallback}' was denied admission.\n\n` +
              `Primary error:\n${err.message}\n\n` +
              `Admission error:\nfallback resolves to provider '${fallbackResolved.parsed.provider}' (primary: '${resolved.parsed.provider}') while admission class '${requestedAdmissionClass}' is requested — a cross-provider fallback is not admitted above '${ADMISSION_COMPLETION_ONLY}'.`,
            'Use a same-provider fallbackModel, or drop the elevated backendAdmissionClass request.',
            err,
          );
        }

        try {
          result = await fallbackResolved.invoke({
            prompt: safePrompt,
            ...(safeSystemPrompt !== undefined ? { systemPrompt: safeSystemPrompt } : {}),
            model: fallbackResolved.parsed.model,
            cwd,
            tag,
            totemDir: config.totemDir,
            temperature: opts.temperature,
            ...(enableContextCaching !== undefined ? { enableContextCaching } : {}),
            ...(cacheTTL !== undefined ? { cacheTTL } : {}),
            ...admissionTransport,
          });
          // Update model/invoke so telemetry and cache log the correct values
          model = fallbackResolved.parsed.model;
          qualifiedModel = fallbackResolved.qualifiedModel;
          resolved = fallbackResolved;
          invoke = fallbackResolved.invoke;
        } catch (fallbackErr: unknown) {
          const originalMsg = err.message;
          const fallbackMsg =
            fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          throw new TotemOrchestratorError(
            `Primary model '${rawModel}' failed and fallback model '${rawFallback}' also failed.\n\n` +
              `Primary error:\n${originalMsg}\n\nFallback error:\n${fallbackMsg}`,
            'Check API quotas and model availability, or try a different model with --model.',
            fallbackErr,
          );
        }
      } else {
        throw new TotemOrchestratorError(
          `Quota exhausted for ${model}.`,
          'Quota resets on a rolling daily window. Options:\n' +
            '  - Switch to a flash model: totem <command> --model <name>\n' +
            '  - Inspect the prompt without calling the API: totem <command> --raw\n' +
            '  - Set a fallbackModel in totem.config.ts',
        );
      }
    } else {
      throw err;
    }
  }

  if (useCache && result.content && result.durationMs > 0) {
    try {
      // Recalculate cache path — `qualifiedModel` reflects any quota fallback
      // resolution that may have happened above. Uses the same helper as the
      // read path so the keys are guaranteed identical (mmnto/totem#1291
      // mmnto/totem#1292 review fix from GCA + CodeRabbit).
      const cacheHash = buildResponseCacheHash(prompt, systemPrompt, qualifiedModel, cacheContract);
      const cacheDir = path.join(configRoot, config.totemDir, 'cache');
      const finalCachePath = path.join(cacheDir, `${tagKey}-${cacheHash}.json`);
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(
        finalCachePath,
        JSON.stringify({
          timestamp: Date.now(),
          content: result.content,
        }),
        { encoding: 'utf-8', mode: 0o600 },
      );
    } catch {
      // Ignore cache write errors
    }
  }

  // ── Grounded run-artifact emission (mmnto-ai/totem#2100) ──
  // Placed AFTER the invoke + quota-fallback resolution so the record carries
  // the RESOLVED backend (qualifiedModel reflects any fallback) and the
  // MASKED prompt (what actually crossed the wire — raw would persist
  // secrets to disk). Failure warns and never fails the run: the run's
  // primary output is not hostage to its ledger (Tenet-4-compliant — the
  // degradation is warned, never silent).
  if (opts.artifact !== undefined) {
    try {
      const inputBundle = {
        maskedPrompt: safePrompt,
        ...(safeSystemPrompt !== undefined && safeSystemPrompt.length > 0
          ? { maskedSystemPrompt: safeSystemPrompt }
          : {}),
        ...(opts.artifact.diffScope !== undefined ? { diffScope: opts.artifact.diffScope } : {}),
        ...(opts.artifact.specContract !== undefined
          ? { specContract: opts.artifact.specContract }
          : {}),
      };
      const runArtifact: RunArtifact = {
        schemaVersion: RUN_ARTIFACT_SCHEMA_VERSION,
        inputBundle,
        inputHash: calculateDeterministicHash(inputBundle),
        grounding: {
          hash: opts.artifact.groundingHash,
          provenanceSummary: opts.artifact.provenanceSummary,
          // Verbatim passthrough — the bundle was assembled and hashed by the
          // caller (mmnto-ai/totem#2101); this seam records, never re-derives
          // or upgrades. Post-reconciliation (#2102): a caller-supplied
          // `groundingBundle` serves this role when `artifact.bundle` is absent.
          ...(groundingBundle !== undefined ? { bundle: groundingBundle } : {}),
        },
        backend: {
          provider: resolved.parsed.provider,
          model,
          qualifiedModel,
          // #2102: caller-supplied wins; the default reproduces the slice-1
          // constant — every undeclared backend is factually completion-only.
          admissionClass: requestedAdmissionClass,
          taskProfile,
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        },
        output: {
          content: result.content,
          metrics: {
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            ...(result.cacheReadInputTokens !== undefined
              ? { cacheReadInputTokens: result.cacheReadInputTokens }
              : {}),
            durationMs: result.durationMs,
            ...(result.finishReason !== undefined ? { finishReason: result.finishReason } : {}),
          },
        },
        // #2102: the admitted contract group is recorded ONLY when the caller
        // supplied at least one member — an omitted contract stays an omitted
        // key, never an empty object (additive 1.x, slice-1 artifacts unchanged).
        ...(opts.outputContract !== undefined ||
        opts.contextPolicy !== undefined ||
        opts.runMetadata !== undefined
          ? {
              admission: {
                ...(opts.outputContract !== undefined
                  ? { outputContract: opts.outputContract }
                  : {}),
                ...(opts.contextPolicy !== undefined ? { contextPolicy: opts.contextPolicy } : {}),
                ...(opts.runMetadata !== undefined ? { runMetadata: opts.runMetadata } : {}),
              },
            }
          : {}),
        createdAt: new Date().toISOString(),
      };
      const saved = saveRunArtifact(path.join(configRoot, config.totemDir), runArtifact);
      log.dim(
        tag,
        `Run artifact ${saved.existed ? 'already recorded' : 'recorded'}: ${saved.hash.slice(0, 12)}…`,
      );
      opts.artifact.onEmitted?.(saved.hash, saved.path);
      // totem-context: by-design degrade per the #2100 failure table — the ledger write is observability; rethrowing would hold the run's PRIMARY output hostage to its record. The degradation is WARNED (Tenet-4-compliant), never silent.
    } catch (err) {
      log.warn(
        tag,
        `Run artifact emission failed (run unaffected): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Log telemetry
  appendTelemetry(
    {
      timestamp: new Date().toISOString(),
      tag,
      model: qualifiedModel,
      promptChars: prompt.length,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs,
    },
    cwd,
    config.totemDir,
  );

  // Console summary
  const secs = (result.durationMs / 1000).toFixed(1);
  if (result.inputTokens != null && result.outputTokens != null) {
    const inTok = result.inputTokens.toLocaleString();
    const outTok = result.outputTokens.toLocaleString();
    log.success(tag, `Done: ${secs}s | ${inTok} in | ${outTok} out`);
  } else {
    log.success(tag, `Done: ${secs}s | ${(prompt.length / 1024).toFixed(0)}KB prompt`);
  }

  // mmnto/totem#1291 Phase 3: surface prompt-cache observability inline so a
  // bulk recompile shows real-world cache savings on every call. The
  // distinction matters: cache_read = served from cache (cheap, fast),
  // cache_creation = wrote a new cache entry (first call in a TTL window,
  // standard input cost). Both are reported separately so the savings ratio
  // is unambiguous.
  if (result.cacheReadInputTokens != null && result.cacheReadInputTokens > 0) {
    log.dim(
      tag,
      `cache hit: ${result.cacheReadInputTokens.toLocaleString()} tokens read from prompt cache`,
    );
  }
  if (result.cacheCreationInputTokens != null && result.cacheCreationInputTokens > 0) {
    log.dim(
      tag,
      `cache write: ${result.cacheCreationInputTokens.toLocaleString()} tokens (first call in TTL window)`,
    );
  }

  return result.content;
}
