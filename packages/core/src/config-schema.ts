import { z } from 'zod';

import { ADMISSION_CLASSES } from './artifacts/schema.js';
import { TotemConfigError } from './errors.js';
import { CustomSecretSchema } from './secrets.js';

/**
 * Zod schema for totem.config.ts — lives at the root of consuming projects.
 */

/**
 * Built-in chunk strategy names. Exported so the literal union derived
 * via `typeof BUILTIN_CHUNK_STRATEGIES[number]` keeps the runtime list
 * and the type signature in sync with a single source of truth. Pack-
 * contributed strategies extend `ChunkStrategy` via the `(string & {})`
 * tail and register at boot through `chunker-registry.ts`.
 */
export const BUILTIN_CHUNK_STRATEGIES = [
  'typescript-ast',
  'markdown-heading',
  'session-log',
  'schema-file',
  'test-file',
  // Fourth-language layer, Stage 1: language-agnostic generic fallback for
  // source with no dedicated chunker yet (Rust/GDScript). Explicit-opt-in
  // only (mmnto-ai/totem#2387, #2308; Prop 256 Option A).
  'generic',
] as const;

/**
 * `ChunkStrategy` schema. Per ADR-097 § 10 + mmnto-ai/totem#1769 strategy
 * lookup goes through `chunker-registry.ts` at runtime; this schema only
 * shape-checks the input string.
 *
 * **Why not refine against the registry here?** Bootstrap chicken-and-egg
 * (Gemini review of mmnto-ai/totem#1768 PR-A): config parse runs BEFORE
 * `loadInstalledPacks()` populates the registry with pack-contributed
 * strategies (the manifest is read AFTER config load by every command).
 * A strict registry-check at parse time would crash `totem sync` on the
 * very edit that adds the pack — user adds `@mmnto/pack-foo` to extends
 * AND a target with `strategy: 'foo-strat'` in the same change, sync
 * fails to parse the config, never writes installed-packs.json, never
 * registers the pack. Forever stuck.
 *
 * The actual fail-loud happens at `createChunker(strategy)` in
 * `chunkers/chunker.ts` — runtime lookup against the post-boot registry
 * with a structured error naming the missing strategy. That's the right
 * boundary because by then the registry IS populated.
 */
export const ChunkStrategySchema = z.string().min(1);

export const ContentTypeSchema = z.enum(['code', 'session_log', 'spec', 'lesson']);

export const IngestTargetSchema = z.object({
  glob: z.string(),
  type: ContentTypeSchema,
  strategy: ChunkStrategySchema,
});

export const OpenAIProviderSchema = z.object({
  provider: z.literal('openai'),
  model: z.string().default('text-embedding-3-small'),
  dimensions: z.number().int().positive().optional(),
});

export const OllamaProviderSchema = z.object({
  provider: z.literal('ollama'),
  model: z.string().default('nomic-embed-text'),
  baseUrl: z.string().default('http://localhost:11434'),
  dimensions: z.number().int().positive().optional(),
});

export const GeminiProviderSchema = z.object({
  provider: z.literal('gemini'),
  model: z.string().default('gemini-embedding-2-preview'),
  dimensions: z.number().int().positive().optional(),
});

export const EmbeddingProviderSchema = z.discriminatedUnion('provider', [
  OpenAIProviderSchema,
  OllamaProviderSchema,
  GeminiProviderSchema,
]);

export const DEFAULT_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.lancedb/**',
  '**/dist/**',
  '**/__tests__/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/.totem/review-extensions.txt',
];

// ─── Orchestrator schemas ────────────────────────────

/** Fields shared across all orchestrator providers */
const BaseOrchestratorFields = {
  /** Default model name if --model is not passed */
  defaultModel: z.string().optional(),
  /** Fallback model used automatically if the primary model fails due to quota/rate limits */
  fallbackModel: z.string().optional(),
  /** Per-command model overrides (e.g., { 'spec': 'gemini-3.1-pro-preview' }) */
  overrides: z.record(z.string()).optional(),
  /** Per-command cache TTLs in seconds (e.g., { 'triage': 3600, 'shield': 0 }) */
  cacheTtls: z.record(z.number()).optional(),
  /**
   * Enable provider-native prompt caching (mmnto/totem#1291 Proposal 217). When true and
   * the provider supports it (Anthropic in 1.15.0, Gemini in 1.16.0+), persistent
   * `systemPrompt` segments will be marked with cache_control directives to
   * reduce input-token cost on repeat invocations within the TTL window.
   * Defaults to undefined (off) — opt-in for 1.15.0 to avoid surprising existing
   * users mid-cycle. Distinct from `cacheTtls` above, which controls the
   * orthogonal response-level cache (mmnto/totem#52, closed) at
   * `.totem/cache/<command>-<hash>.json`.
   */
  enableContextCaching: z.boolean().optional(),
  /**
   * Prompt cache TTL in seconds (mmnto/totem#1291). Anthropic supports exactly
   * two values today: 300 (5m, default ephemeral) and 3600 (1h, extended cache
   * — 2x write cost, ~10% read cost). Only consulted when
   * `enableContextCaching` is true. Defaults to 300 when omitted.
   *
   * Constrained to literals at parse time so invalid TTLs (e.g. 600, 1800)
   * fail fast at config load instead of silently falling through to 5m at
   * provider-invocation time. Caught by CodeRabbit on PR #1292 review.
   * Anthropic docs verified for both values:
   * https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
   */
  cacheTTL: z.union([z.literal(300), z.literal(3600)]).optional(),
  /**
   * Declared backend-capability contract (mmnto-ai/totem#2102, strategy#474
   * slice 3). `admissionClasses` lists the backend admission classes this
   * orchestrator is declared capable of serving; canonical values live in
   * core `ADMISSION_CLASSES`. Read by the `runOrchestrator` admission gate
   * only: a caller requesting a class above `completion_only` that is not
   * declared here fails loud BEFORE any provider invoke (no tokens spent,
   * no artifact emitted). Absent = `['completion_only']` — factually true
   * of every backend today. A declaration is a capability claim, never an
   * enforcement mechanism (output enforcement is caller-side, #2103).
   */
  capabilities: z
    .object({
      admissionClasses: z.array(z.enum(ADMISSION_CLASSES)).optional(),
    })
    .optional(),
};

export const ShellOrchestratorSchema = z.object({
  provider: z.literal('shell'),
  /** Shell command with {file} and {model} placeholders */
  command: z.string(),
  ...BaseOrchestratorFields,
});

export const GeminiOrchestratorSchema = z.object({
  provider: z.literal('gemini'),
  ...BaseOrchestratorFields,
});

export const AnthropicOrchestratorSchema = z.object({
  provider: z.literal('anthropic'),
  ...BaseOrchestratorFields,
});

export const OpenAIOrchestratorSchema = z.object({
  provider: z.literal('openai'),
  /** Optional base URL for OpenAI-compatible servers (Ollama, LM Studio, etc.) */
  baseUrl: z.string().url().optional(),
  ...BaseOrchestratorFields,
});

export const OllamaOrchestratorSchema = z.object({
  provider: z.literal('ollama'),
  /** Base URL for the Ollama server */
  baseUrl: z.string().default('http://localhost:11434'),
  /** Context length passed to Ollama as num_ctx (controls KV cache / VRAM usage) */
  numCtx: z.number().int().positive().optional(),
  ...BaseOrchestratorFields,
});

export const OrchestratorSchema = z.discriminatedUnion('provider', [
  ShellOrchestratorSchema,
  GeminiOrchestratorSchema,
  AnthropicOrchestratorSchema,
  OpenAIOrchestratorSchema,
  OllamaOrchestratorSchema,
]);

/**
 * Auto-migrate legacy orchestrator configs that lack a `provider` field.
 * If `command` is present without `provider`, injects `provider: 'shell'`.
 */
function autoMigrateOrchestrator(val: unknown): unknown {
  if (
    val &&
    typeof val === 'object' &&
    !Array.isArray(val) &&
    'command' in val &&
    !('provider' in val)
  ) {
    return { ...(val as Record<string, unknown>), provider: 'shell' };
  }
  return val;
}

export const GarbageCollectionSchema = z.object({
  /** Whether GC runs during `totem doctor` */
  enabled: z.boolean().default(true),
  /** Minimum age (days since compiledAt) before a rule is GC-eligible */
  minAgeDays: z.number().int().min(1).default(90),
  /** Rule categories exempt from GC (matches `category` field on compiled rules) */
  exemptCategories: z
    .array(z.enum(['security', 'architecture', 'style', 'performance']))
    .default(['security']),
});

/**
 * Doctor configuration (mmnto-ai/totem#1483). Controls the stale-rule
 * advisory window in `totem doctor`. A single integer threshold on
 * `RuleMetric.evaluationCount`.
 */
export const DoctorConfigSchema = z
  .object({
    /**
     * Minimum cumulative `RuleMetric.evaluationCount` before `totem doctor` will
     * flag a rule as stale (zero `contextCounts.code` over the rule's lifetime).
     *
     * v1 uses cumulative-lifetime semantics: a rule fires once ever, then goes
     * silent, and stays exempt. mmnto-ai/totem#1550 tracks swapping to true
     * rolling-window semantics via `RuleMetric.runHistory` ring buffer. The
     * config key stays; only the underlying math upgrades. No user migration.
     */
    staleRuleWindow: z.number().int().min(1).default(10),
  })
  .default({});

export const DocTargetSchema = z.object({
  /** Relative path to the document */
  path: z.string(),
  /** Description of the document's purpose (included in the LLM prompt) */
  description: z.string(),
  /** When to remind/auto-run: 'post-release' or 'on-change' */
  trigger: z.enum(['post-release', 'on-change']).default('post-release'),
  /** Whether this doc receives user-facing post-processing (issue ref stripping, manual content, live metrics). Defaults to true for readme.md files. */
  userFacing: z.boolean().optional(),
});

export const ConfigTierSchema = z.enum(['lite', 'standard', 'full']);
export type ConfigTier = z.infer<typeof ConfigTierSchema>;

/**
 * `totem orient` configuration (mmnto-ai/totem#2044, WS2).
 *
 * `orient` derives session state from primitives (open PRs/issues/board/freeze)
 * with zero LLM. The GH Project board is the only piece that cannot be derived
 * from the current repo alone — a board lives under an `owner` and a numeric
 * project id. Owner is derived from `gh repo view`; the project NUMBER is the
 * one consumer-specific value, so it is read from this OPTIONAL field (env
 * `TOTEM_ORIENT_PROJECT` overrides last). When unset, orient renders the board
 * section as an honest "no board configured" absence — never an error
 * (Tenet 14). This must NOT bake the cohort's board into a shipped command —
 * Totem is NOT zero-user.
 */
export const OrientConfigSchema = z.object({
  /** GH Project number for the in-flight board section (e.g. 1). Optional. */
  projectNumber: z.number().int().positive().optional(),
  /**
   * Config-path to the cohort parity manifest (`parity-manifest.yaml`) the
   * `totem doctor --parity` sensor parses for cross-repo drift
   * (mmnto-ai/totem-strategy#448). Mirrors `projectNumber` as the one
   * consumer-specific value the sensor cannot derive from the repo alone —
   * the manifest is strategy-owned, so its location is per-consumer. Resolved
   * relative to the config/repo root by `resolveParityManifestPath`. OPTIONAL:
   * when unset, the sensor renders an honest "no parity manifest configured"
   * skip — never an error (Tenet 14, honest-absent).
   */
  parityManifest: z.string().optional(),
  /**
   * Cross-repo read set for the `network-read-only` parity probes
   * (Prop 296 §14, mmnto-ai/totem-strategy#962). Each entry is an `owner/repo`
   * slug the doctor additionally issues read-only GitHub-settings/rulesets/
   * branch-protection GETs against when sensing the posture rows
   * (`repo-merge-posture`, `repo-required-checks-posture`,
   * `repo-branch-protection-posture`). ADDITIVE + OPTIONAL: the CURRENT repo
   * (derived from the git remote) is ALWAYS probed; this list only widens the
   * roster. §14 clause 3 makes the CI/consumer default current-repo-only —
   * cross-repo reads need a cross-repo-privileged seat token, so a repo-scoped
   * CI token that cannot see siblings degrades each extra repo to a per-repo
   * cannot-verify line, never a manifest-wide outage.
   */
  parityProbeRepos: z.array(z.string()).optional(),
});

/**
 * `totem ecl-gc --compact` cohort completeness roster (mmnto-ai/totem#2310;
 * ADR-106 § A2.2 + ecl-discipline § 4.5).
 *
 * `cohortRepos` is the declared expected-repo yardstick the compaction
 * completeness gate checks the live workspace glob against: a `processed/` mark
 * may be collected only against a PROVABLY-complete poll, and "complete"
 * requires every expected outbox-holding repo present + scanned. A silently-
 * absent cohort repo makes a live mark in its unscanned outbox look inert (the
 * false-unread class), so the roster is the yardstick that makes an incomplete
 * scan detectable.
 *
 * Values are bare workspace DIRECTORY names (e.g. `totem`, `totem-strategy`),
 * matched against the sibling directories of the workspace root — NOT
 * `owner/repo` slugs. This is CONSUMER-DECLARED config, not a baked product
 * identity (Tenet 16 / the A2.2 contract): an external consumer's cohort is
 * THEIR repos, so the roster cannot ship as a core constant. It replaces the
 * interim `cohortRepos()` core constant (shipped 1.90.0, product-locked). The
 * change-authority for OUR cohort's value stays mmnto-ai/totem-strategy#611.
 *
 * `.min(1)`: an EMPTY `cohortRepos: []` is a config BUG (loud Zod failure at
 * load), NEVER a synonym for "undeclared". Omitting the `ecl` block (or the
 * `cohortRepos` key) is the honest undeclared state → the compaction gate
 * hard-aborts (exit 3, non-`--force-incomplete`-waivable). A genuine single-
 * repo consumer declares a roster of one (completeness-1, the A2.2 line).
 */
export const EclConfigSchema = z.object({
  /** Declared cohort repo roster (bare workspace dir names) for the `totem
   *  ecl-gc --compact` A2.2 completeness gate. Optional: absent ⇒ undeclared ⇒
   *  the gate hard-aborts. `.min(1)`: an empty array is a loud config error. */
  cohortRepos: z.array(z.string().min(1)).min(1).optional(),
});

/**
 * Default source extensions used when computing the review content hash.
 * Historical hardcoded set, preserved for backward compatibility with
 * pre-#1527 consumers. Polyglot repos override via `review.sourceExtensions`.
 */
export const DEFAULT_REVIEW_SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;

/**
 * Per-extension schema for `review.sourceExtensions`. Accepts either `"ts"`
 * or `".ts"` (normalizes to leading-dot form). The `.refine()` regex is the
 * shell-injection boundary: these strings are later passed as `git ls-files`
 * glob arguments on both the TS side (via safeExec) and the bash side
 * (via shell globs). The regex rejects `*`, `;`, quotes, backticks, spaces,
 * newlines, and any other character that could break out of a glob arg.
 */
export const ReviewSourceExtensionSchema = z
  .string()
  .transform((s) => (s.startsWith('.') ? s : '.' + s))
  .refine(
    (s) => /^\.[a-z0-9][a-z0-9.-]*$/i.test(s),
    'must match /\\.[A-Za-z0-9.-]+/ after normalization',
  );

/**
 * Stage 4 verification baseline overrides (mmnto-ai/totem#1683).
 *
 * `extend` adds globs to the default baseline; `exclude` removes them. Both
 * default to `[]`. Naming discipline (per the GCA finding logged in ADR-091
 * Deferred Decisions): no `allowlist` aliases. The schema explicitly rejects
 * an `allowlist` key with a pointer to mmnto-ai/totem#1683 so a future
 * regression surfaces at config-parse time, not in a silent passthrough.
 */
const STAGE4_BASELINE_KNOWN_KEYS = new Set(['extend', 'exclude']);

export const Stage4BaselineConfigSchema = z
  .object({
    extend: z.array(z.string()).default([]),
    exclude: z.array(z.string()).default([]),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    const raw = data as Record<string, unknown>;
    // Naming-discipline guard: the `allowlist` key gets a custom error
    // message that points at mmnto-ai/totem#1683 so a future regression
    // surfaces with the right rationale at config-parse time.
    if ('allowlist' in raw) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Use 'baseline' framing (extend / exclude) — 'allowlist' is rejected per mmnto-ai/totem#1683 naming discipline.",
        path: ['allowlist'],
      });
    }
    // Reject other unknown keys (e.g. typos like `exlcude`/`extends`) at
    // parse time rather than letting them silently passthrough and become
    // load-bearing-but-ignored config (CR mmnto-ai/totem#1766 R1).
    for (const key of Object.keys(raw)) {
      if (key === 'allowlist') continue; // handled above with a custom message
      if (!STAGE4_BASELINE_KNOWN_KEYS.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.unrecognized_keys,
          keys: [key],
          path: [],
        });
      }
    }
  });

export const ReviewConfigSchema = z
  .object({
    sourceExtensions: z
      .array(ReviewSourceExtensionSchema)
      .min(1, 'review.sourceExtensions must contain at least one extension')
      .default([...DEFAULT_REVIEW_SOURCE_EXTENSIONS]),
    stage4Baseline: Stage4BaselineConfigSchema.optional(),
    /**
     * Opt-in multi-lane review fan (Prop 304 R2, mmnto-ai/totem#2106). Each
     * entry is a `provider:model` lane the reviewer runs independently over the
     * one masked diff, converging on a verdict artifact. A DECLARED key here
     * (this schema is otherwise `.passthrough()`) so `config.review.lanes` is
     * typed rather than an untyped passthrough value (codex fold 7).
     *
     * ABSENT ⇒ the legacy single-lane path runs byte-for-byte as today
     * (invariant 7). PRESENT ⇒ the fan path, and present means ≥1: an
     * explicitly-configured EMPTY array (`lanes: []`) is a hard config PARSE
     * error (`.min(1)`), never a silent synonym for the legacy default
     * (totem-codex finding 11) — omit the key to opt out.
     *
     * Zod validates only the SHAPE here (`string[]`, nonempty). The remaining
     * SEMANTIC contract — known `provider:model` entries, the shell provider
     * rejected, no empty/duplicate normalized entries — is enforced CLI-side by
     * `validateReviewLanes`, which reuses the CLI's
     * `parseModelString`/`assertValidModelName` (core cannot import from cli).
     * An explicit `--model` selects a ONE-lane invocation and never joins or
     * overrides this fan.
     */
    lanes: z.array(z.string().min(1)).min(1).optional(),
  })
  .passthrough()
  .default({});

export const TotemConfigSchema = z.object({
  /** Glob patterns and chunking strategies for each ingest target */
  targets: z.array(IngestTargetSchema).min(1),

  /** Embedding provider configuration (optional for Lite tier) */
  embedding: EmbeddingProviderSchema.optional(),

  /** Optional: LLM orchestrator for spec/triage/shield commands */
  orchestrator: z.preprocess(autoMigrateOrchestrator, OrchestratorSchema).optional(),

  /** Optional: override the .totem/ directory path */
  totemDir: z
    .string()
    .default('.totem')
    .refine((p) => !/^(\/|\\|[A-Za-z]:)/.test(p), 'totemDir must be a relative path'),

  /** Optional: override the .lancedb/ directory path */
  lanceDir: z
    .string()
    .default('.lancedb')
    .refine((p) => !/^(\/|\\|[A-Za-z]:)/.test(p), 'lanceDir must be a relative path'),

  /**
   * Optional: glob patterns to exclude from indexing.
   *
   * Back-compat note (mmnto-ai/totem#1748): these patterns are ALSO merged
   * into the lint/shield diff filter, so they remove files from review scope
   * — the diff layer now discloses each drop loudly. For index-only intent
   * ("keep on disk and lintable, out of the semantic index") use
   * `indexIgnorePatterns`. The 2.0.0 split that removes this key from lint
   * scope is registered in mmnto-ai/totem#1746.
   */
  ignorePatterns: z.array(z.string()).default(DEFAULT_IGNORE_PATTERNS),

  /**
   * Optional: glob patterns excluded ONLY from indexing — never from
   * lint/shield scope (mmnto-ai/totem#1748, upstream-feedback/046). This is
   * the clean home for "don't embed this into the semantic index" intent.
   */
  indexIgnorePatterns: z.array(z.string()).optional().default([]),

  /** Optional: additional glob patterns to exclude from deterministic shield scanning (merged with ignorePatterns) */
  shieldIgnorePatterns: z.array(z.string()).optional().default([]),

  /** Character count threshold for MCP context payload warnings (~4 chars ≈ 1 token). Default: 40,000 (~10k tokens). */
  contextWarningThreshold: z.number().int().positive().default(40_000),

  /**
   * Minimum per-hit relevance (vector-leg similarity, 0..1) below which the
   * `search_knowledge` tool reports `status="no_useful_hits"` rather than
   * returning noise-floor matches (mmnto-ai/totem#2463). Floors on the true
   * relevance signal, NOT the RRF rank artifact in the displayed `score`. The
   * per-call `min_relevance` MCP input overrides this; the retrieval-envelope
   * always discloses the effective floor. Default 0.25 (pilot-calibrated).
   */
  searchRelevanceFloor: z.number().min(0).max(1).default(0.25),

  /** Optional: documents to auto-update via `totem docs` */
  docs: z.array(DocTargetSchema).optional(),

  /** Optional: export targets for cross-model lesson enforcement (e.g., { gemini: '.gemini/styleguide.md' }) */
  exports: z.record(z.string()).optional(),

  /** Optional: GitHub repositories to aggregate issues from (e.g., ['owner/repo', 'owner/repo2']) */
  repositories: z.array(z.string()).optional(),

  /** Optional: bot boilerplate markers to filter from PR comments during `totem extract` (e.g., ['Using Gemini Code Assist', 'Copilot']) */
  botMarkers: z.array(z.string()).optional(),

  /** Optional: paths to other totem-managed directories whose indexes should be queried alongside this one (e.g., ['.strategy', '../docs-repo']) */
  linkedIndexes: z.array(z.string()).optional(),

  /**
   * Optional: pack package names to extend rules from (ADR-085 + ADR-097).
   *
   * Each entry is a pack name like `@mmnto/pack-rust-architecture`. The
   * pack must also appear in the consumer's `package.json` dependencies
   * (or devDependencies) so npm/pnpm can resolve it. Pack-merge logic
   * (`packages/core/src/pack-merge.ts`) reads pack rules at lint time.
   * Pack discovery (`packages/core/src/pack-discovery.ts`,
   * mmnto-ai/totem#1768) reads this field plus the project's
   * package.json dependencies, deduplicates, and writes the union to
   * `.totem/installed-packs.json` for boot-time registration.
   */
  extends: z.array(z.string().min(1)).optional(),

  /**
   * Optional: path override for the strategy repository (mmnto-ai/totem#1710).
   *
   * Resolved relative to the git root by `resolveStrategyRoot`, with the
   * `TOTEM_STRATEGY_ROOT` (or legacy `STRATEGY_ROOT`) env var taking
   * precedence. When unset, the resolver falls back to a sibling
   * `../totem-strategy/` clone, then to the legacy `.strategy/` submodule.
   *
   * Trimmed and required to be non-empty so a `strategyRoot: ''` typo
   * fails fast at config-parse time instead of silently falling through
   * to the next precedence layer (R3 — CR R3 nitpick).
   */
  strategyRoot: z.string().trim().min(1).optional(),

  /**
   * Optional: path override for the substrate repository (mmnto-ai/totem#1820,
   * ADR-100 Phase C).
   *
   * Resolved relative to the config root by `resolveSubstratePaths`, with the
   * `TOTEM_SUBSTRATE_PATH` env var taking precedence. When unset, the
   * resolver walks up to 3 levels from the config root looking for a
   * `<parent>/totem-substrate/` sibling clone, then falls back to repo-local
   * `.handoff/` and `.journal/` sediment paths.
   *
   * Trimmed and required to be non-empty so a `substratePath: ''` typo
   * fails fast at config-parse time instead of silently falling through
   * to the next precedence layer (mirrors `strategyRoot` validation).
   */
  // totem-context: `.trim().min(1)` already follows the recommended pattern; lint rule's regex misfires here.
  substratePath: z.string().trim().min(1).optional(),

  /** Optional: named partitions mapping logical aliases to file path prefixes for context isolation (e.g., { core: ['packages/core/'], mcp: ['packages/mcp/'] }) */
  partitions: z.record(z.array(z.string().min(1)).min(1)).optional(),

  /** Optional: custom secret patterns for DLP redaction (shared, version-controlled) */
  secrets: z.array(CustomSecretSchema).optional(),

  /** Optional: automatically extract lessons when shield returns a FAIL verdict (#779) */
  shieldAutoLearn: z.boolean().default(false),

  /** Optional: garbage collection settings for stale compiled rules */
  garbageCollection: GarbageCollectionSchema.optional(),

  /** Optional: doctor stale-rule advisory thresholds (mmnto-ai/totem#1483) */
  doctor: DoctorConfigSchema.optional(),

  /** Optional: pilot mode — warn-only hooks during initial adoption.
   *  `true` uses defaults (14 days / 50 pushes). Object form overrides thresholds. */
  pilot: z
    .union([
      z.boolean(),
      z.object({
        maxDays: z.number().int().positive().default(14),
        maxPushes: z.number().int().positive().default(50),
      }),
    ])
    .optional(),

  /** Optional: enforcement hook tier configuration */
  hooks: z
    .object({
      /** Enforcement tier: 'strict' adds spec-completed checks and shield gates.
       *  Agents are auto-detected and enforced at strict level regardless of this setting. */
      tier: z.enum(['strict', 'standard']).default('standard'),
    })
    .optional(),

  /** Review gate configuration. `sourceExtensions` drives the content-hash
   *  computation in `writeReviewedContentHash()` and `.claude/hooks/content-hash.sh`.
   *  Polyglot repos extend the default `['.ts', '.tsx', '.js', '.jsx']` to cover
   *  additional source languages (e.g., `['.rs', '.gd']` for Rust + Godot). */
  review: ReviewConfigSchema,

  /** Optional: `totem orient` settings (e.g. `{ projectNumber: 1 }` for the GH Project board). */
  orient: OrientConfigSchema.optional(),

  /** Optional: `totem ecl-gc --compact` settings — the consumer-declared cohort
   *  completeness roster (`{ cohortRepos: ['totem', ...] }`, mmnto-ai/totem#2310). */
  ecl: EclConfigSchema.optional(),
});

/**
 * `ChunkStrategy` keeps the literal union of built-in strategy names for
 * IntelliSense on core code paths while admitting any string registered
 * via Pack registration callbacks at boot. The Zod schema validates the
 * runtime value against the registry; this type alias lives independently
 * so callers don't lose type safety on built-in names. Per ADR-097 § 10 +
 * mmnto-ai/totem#1769.
 */
export type ChunkStrategy = (typeof BUILTIN_CHUNK_STRATEGIES)[number] | (string & {});
export type ContentType = z.infer<typeof ContentTypeSchema>;
export type IngestTarget = z.infer<typeof IngestTargetSchema>;
export type EmbeddingProvider = z.infer<typeof EmbeddingProviderSchema>;
export type Orchestrator = z.infer<typeof OrchestratorSchema>;
export type GarbageCollectionConfig = z.infer<typeof GarbageCollectionSchema>;
export type DoctorConfig = z.infer<typeof DoctorConfigSchema>;
export type DocTarget = z.infer<typeof DocTargetSchema>;
export type OrientConfig = z.infer<typeof OrientConfigSchema>;
export type EclConfig = z.infer<typeof EclConfigSchema>;
export type TotemConfig = z.infer<typeof TotemConfigSchema>;

/**
 * Supported config file names in resolution priority order.
 * .ts is preferred (full TypeScript support), static formats are fallbacks.
 */
export const CONFIG_FILES = ['totem.config.ts', 'totem.yaml', 'totem.yml', 'totem.toml'] as const;

/**
 * Determine the configuration tier based on what's configured.
 * - lite: no embedding, no orchestrator (memory-only features)
 * - standard: embedding configured (sync, search, stats)
 * - full: embedding + orchestrator (all commands)
 */
export function getConfigTier(config: TotemConfig): ConfigTier {
  if (!config.embedding) return 'lite';
  if (!config.orchestrator) return 'standard';
  return 'full';
}

/**
 * Assert that an embedding provider is configured. Throws a friendly error
 * directing the user to configure one via `totem init` or `totem.config.ts`.
 */
export function requireEmbedding(config: TotemConfig): EmbeddingProvider {
  if (!config.embedding) {
    throw new TotemConfigError(
      'No embedding provider configured. This command requires embeddings (Lite tier does not support it).',
      "Set OPENAI_API_KEY or GEMINI_API_KEY in your .env and re-run 'totem init'.",
    );
  }
  return config.embedding;
}
