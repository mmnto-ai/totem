/**
 * `@mmnto/totem/config` — supported config-schema entry point.
 *
 * Curated, semver-tracked re-export of the `TotemConfig` type and the
 * config-schema surface (schemas, tiers, defaults). This is the ONE hard
 * cross-repo cohort contract: the only barrel import cohort repos take today
 * is `import type { TotemConfig } from '@mmnto/totem'`, and this subpath is
 * its supported home.
 *
 * Every name here is also re-exported from the legacy root barrel (`.`) for
 * backward compatibility; this aggregator narrows that surface to an
 * intentional, curated subset. Config-schema names the barrel deliberately
 * omits (e.g. `OpenAIOrchestratorSchema`, `Stage4BaselineConfigSchema`,
 * `BUILTIN_CHUNK_STRATEGIES`) stay off this surface on purpose.
 *
 * Additive per mmnto-ai/totem#2336 (ADR-084 / Proposal 294). The root barrel
 * is unchanged; nothing is removed from it in this cut.
 */

// Config-schema types — `TotemConfig` plus every transitive config-schema
// type alias it composes (all `z.infer` aliases exported by config-schema.ts).
export type {
  ChunkStrategy,
  ConfigTier,
  ContentType,
  DocTarget,
  DoctorConfig,
  EclConfig,
  EmbeddingProvider,
  GarbageCollectionConfig,
  IngestTarget,
  Orchestrator,
  OrientConfig,
  TotemConfig,
} from './config-schema.js';

// Config-schema values — schemas, tier helpers, and shipped defaults.
export {
  AnthropicOrchestratorSchema,
  ChunkStrategySchema,
  CONFIG_FILES,
  ConfigTierSchema,
  ContentTypeSchema,
  DEFAULT_IGNORE_PATTERNS,
  DEFAULT_REVIEW_SOURCE_EXTENSIONS,
  DocTargetSchema,
  DoctorConfigSchema,
  EclConfigSchema,
  EmbeddingProviderSchema,
  GarbageCollectionSchema,
  GeminiOrchestratorSchema,
  GeminiProviderSchema,
  getConfigTier,
  IngestTargetSchema,
  OllamaProviderSchema,
  OpenAIProviderSchema,
  OrchestratorSchema,
  OrientConfigSchema,
  requireEmbedding,
  ReviewConfigSchema,
  ReviewSourceExtensionSchema,
  ShellOrchestratorSchema,
  TotemConfigSchema,
} from './config-schema.js';
