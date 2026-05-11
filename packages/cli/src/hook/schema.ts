import { z } from 'zod';

/**
 * Hook rule schemas for the bot-pack wiring engine (ADR-104).
 *
 * Two surfaces:
 * - `HooksYamlSchema` describes a pack's `hooks.yaml` (authoring surface).
 * - `CompiledHooksManifestSchema` describes `.totem/compiled-hooks.json`
 *   (runtime surface produced by `totem sync` from installed packs).
 *
 * The compiled manifest carries the staleness metadata required by
 * ADR-104 § Decision 3: schemaVersion + compiledAt + sourcePackVersions.
 */

const HookCheckTypeSchema = z.enum(['reject-if-match', 'reject-if-no-match']);

export type HookCheckType = z.infer<typeof HookCheckTypeSchema>;

/**
 * Validate that a regex pattern compiles. Runs at parse time so an invalid
 * pack pattern surfaces as a schema validation error rather than a runtime
 * crash inside `evaluateHook` (Tenet 4: don't fail open silently on
 * invalid input).
 */
const RegexPatternSchema = z
  .string()
  .min(1)
  .refine(
    (p) => {
      try {
        new RegExp(p);
        return true; // totem-context: intentional — catch below is throw-as-control-flow for regex validation
      } catch {
        return false;
      }
    },
    { message: 'pattern is not a valid regular expression' },
  );

const HookTriggerSchema = z.object({
  tool: z.string().min(1),
  pattern: RegexPatternSchema,
});

const HookCheckSchema = z.object({
  pattern: RegexPatternSchema,
  type: HookCheckTypeSchema,
});

/**
 * Authoring-surface schema for a single hook rule in a pack's `hooks.yaml`.
 *
 * The optional `recoveryHint` field (ADR-104 § Decision 1) gives agents the
 * WHAT-INSTEAD on a block — recommended but not required in V1. Adoption
 * tracked toward a V2 upgrade-to-required trigger (>80% of published rules
 * carry it, OR an empirically-observed retry-loop incident).
 *
 * The `verification_shadow` field is reserved for the Spine Rule
 * classification path (ADR-104 § Convergence + Q1 binding). In V1 the engine
 * MUST warn-and-ignore any verification_shadow on a hook rule (hooks are
 * Interpretive Rule class — no formal verification obligation). Schema
 * accepts it permissively so future Spine-Rule promotion does not require
 * a schema break.
 */
export const HookRuleSchema = z.object({
  id: z.string().min(1),
  trigger: HookTriggerSchema,
  check: HookCheckSchema,
  message: z.string().min(1),
  recoveryHint: z.string().optional(),
  verification_shadow: z.unknown().optional(),
});

export type HookRule = z.infer<typeof HookRuleSchema>;

export const HOOKS_YAML_SCHEMA_VERSION = 1 as const;

/**
 * Per-pack `hooks.yaml` file shape. The `version` field is the contract
 * for forward-compat: when `totem sync` parses an unknown version (higher
 * than the runner supports), it warns-and-skips that pack entirely
 * (ADR-104 § Decision 4).
 */
export const HooksYamlSchema = z
  .object({
    version: z.number().int().positive(),
    hooks: z.array(HookRuleSchema),
  })
  .superRefine((data, ctx) => {
    // Duplicate hook ids within a single pack would make the
    // `<packId>/<ruleId>` provenance in rejection messages (ADR-104 § Decision 1)
    // ambiguous. Enforce uniqueness at parse time so a misauthored pack fails
    // on load rather than producing non-deterministic rejection trails.
    const seen = new Set<string>();
    data.hooks.forEach((hook, i) => {
      if (seen.has(hook.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate hook id within pack: ${hook.id}`,
          path: ['hooks', i, 'id'],
        });
      }
      seen.add(hook.id);
    });
  });

export type HooksYaml = z.infer<typeof HooksYamlSchema>;

export const COMPILED_HOOKS_SCHEMA_VERSION = 1 as const;

/**
 * A compiled hook rule carries provenance (`packId`) so rejection messages
 * can name `<packId>/<ruleId>` (ADR-104 § Decision 1) and so staleness
 * checks can scope per-pack.
 */
export const CompiledHookRuleSchema = HookRuleSchema.extend({
  packId: z.string().min(1),
});

export type CompiledHookRule = z.infer<typeof CompiledHookRuleSchema>;

/**
 * Runtime-surface manifest produced by `totem sync` and read on every
 * `totem hook run` invocation. The metadata fields are load-bearing for
 * ADR-104 § Decision 3 (staleness detection):
 *
 * - `schemaVersion`: bumps on breaking structural change to this manifest
 * - `compiledAt`: ISO 8601 timestamp of last compile
 * - `sourcePackVersions`: pack name → version at compile time; compared
 *   against package.json resolutions to emit `[totem:hook-stale]` warnings
 *   when packs have updated since last compile
 */
export const CompiledHooksManifestSchema = z.object({
  schemaVersion: z.literal(COMPILED_HOOKS_SCHEMA_VERSION),
  compiledAt: z.string().datetime(),
  sourcePackVersions: z.record(z.string(), z.string()),
  hooks: z.array(CompiledHookRuleSchema),
});

export type CompiledHooksManifest = z.infer<typeof CompiledHooksManifestSchema>;
