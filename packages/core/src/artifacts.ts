/**
 * `@mmnto/totem/artifacts` — supported verdict-artifact entry point.
 *
 * Curated, semver-tracked re-export of the Prop 302 verdict-artifact surface:
 * the `VerdictArtifactSchema`, the content-address-verified loader
 * (`loadVerdictArtifact`), the schema-version constants, the derived
 * settle/cache predicates, the lineage-key + content-hash helpers, and the
 * verdict store read/write helpers. This is the lane-convergence artifact
 * consumers of `.totem/artifacts/verdicts/` bind to.
 *
 * Deliberately scoped to the verdict artifact. The broader run-artifact /
 * grounding / panel / post-check schemas (also under `./artifacts/**` in the
 * barrel) are a larger, less-settled surface and stay off this supported
 * entry for now to keep the promise narrow — they remain reachable via the
 * legacy root barrel (`.`).
 *
 * Every name here is also re-exported from the legacy root barrel (`.`).
 * Additive per mmnto-ai/totem#2336 (ADR-084 / Proposal 294). The root barrel
 * is unchanged; nothing is removed from it in this cut.
 */

// Verdict-artifact types (Prop 302 / 304 R2, mmnto-ai/totem#2106).
export type {
  LineageKeyInput,
  SaveVerdictArtifactResult,
  VerdictArtifact,
  VerdictDiffScope,
  VerdictDiffSource,
  VerdictFinding,
  VerdictFindingSeverity,
  VerdictLane,
  VerdictLaneFailureReason,
  VerdictLaneSummary,
  VerdictPredicateInput,
  VerdictRound,
  VerdictWithAddress,
} from './artifacts/verdict.js';

// Verdict-artifact schemas, version constants, derived predicates,
// lineage/hash helpers, and the content-address-verified store surface.
export {
  computeLineageKey,
  computeVerdictArtifactContentHash,
  deriveCacheEligible,
  deriveSettled,
  findLatestVerdictForLineage,
  LaneIdSchema,
  listVerdictArtifacts,
  loadVerdictArtifact,
  renderCovariateLine,
  saveVerdictArtifact,
  VERDICT_ARTIFACT_KNOWN_MAJOR,
  VERDICT_ARTIFACT_SCHEMA_VERSION,
  VERDICT_DIFF_SOURCES,
  VERDICT_LANE_FAILURE_REASONS,
  VerdictArtifactSchema,
  VerdictDiffScopeSchema,
  VerdictFindingSchema,
  VerdictFindingSeveritySchema,
  VerdictLaneSchema,
  VerdictLaneSummarySchema,
  VerdictRoundSchema,
  verdictsDir,
} from './artifacts/verdict.js';
