/**
 * Pack rule merge primitive (ADR-085 + ADR-089, mmnto-ai/totem#1485).
 *
 * The default pack-merge semantic from ADR-085 Resolved Decision 3 is
 * "Local Supreme Authority": when a repo's local `compiled-rules.json`
 * declares the same `lessonHash` as an inherited pack rule, the local
 * entry wins. This preserves the "my repo, my rules" principle.
 *
 * ADR-089 carves out a narrow exception: rules shipped by a pack with
 * `immutable: true` AND `severity: 'error'` cannot be locally downgraded
 * or archived. Security packs like `@mmnto/pack-agent-security` rely on
 * this contract to guarantee that enforcement cannot be silently weakened
 * by a motivated local override.
 *
 * This module is the pure primitive that encodes both rules. It does
 * NOT know about pack install paths, config resolution, or the filesystem —
 * callers hand it two arrays and receive the merged array back. Phase C
 * will wire a consumer (`totem install` + pack-config resolution) around
 * this primitive. Until then the logic is fully unit-tested in memory so
 * the enforcement contract is ready the day pack distribution lands.
 */

import type { CompiledRule } from './compiler-schema.js';

// ─── Types ──────────────────────────────────────────

/**
 * Explains why a local override was refused. Accumulated into the merge
 * result so callers can surface every blocked attempt without swallowing
 * the detail. Useful for `totem install` diagnostics and for the Trap
 * Ledger snapshot a future pack-build flow may capture.
 */
export interface ImmutableOverrideBlock {
  /** The lessonHash of the immutable pack rule whose local override was rejected. */
  lessonHash: string;
  /** Human-readable name for log output. */
  lessonHeading: string;
  /** Which aspect of the local rule the merge refused to honor. */
  attemptedChange: 'severity-downgrade' | 'archive' | 'both';
  /** The severity the local rule tried to set. Absent for archive-only overrides. */
  attemptedSeverity?: 'warning' | 'error';
  /** The severity the pack enforces. Always 'error' — immutable is currently error-only. */
  enforcedSeverity: 'error';
}

export interface MergeRulesResult {
  /** The merged rule array. One entry per unique `lessonHash`. */
  rules: CompiledRule[];
  /**
   * Immutable overrides the merge blocked. Empty when no local rule tried
   * to downgrade or archive an immutable pack rule. Callers that want a
   * hard error on any blocked override can check `blocks.length > 0`.
   */
  blocks: ImmutableOverrideBlock[];
}

// ─── Merge ──────────────────────────────────────────

/**
 * Merge local and pack rule arrays according to ADR-085 + ADR-089 semantics.
 *
 * Precedence:
 *   - When a `lessonHash` appears in both arrays, local wins (ADR-085
 *     Local Supreme Authority)
 *   - EXCEPT when the pack rule carries `immutable: true` AND
 *     `severity: 'error'`: the pack's severity is preserved and any local
 *     `status: 'archived'` is cleared back to active. The rest of the
 *     local rule's shape (pattern, message, fileGlobs, badExample) is
 *     still honored — immutable protects the enforcement knob, not the
 *     rule body. A pack author that needs to freeze the pattern as well
 *     should simply ship the rule without a matching local entry.
 *
 * Non-immutable pack rules follow pure local precedence: the local entry
 * replaces the pack entry byte-for-byte.
 *
 * Rules that appear only in `packRules` are appended as-is. Rules that
 * appear only in `localRules` are emitted as-is. Pure function — does
 * not mutate its inputs.
 */
export function mergeRules(
  localRules: readonly CompiledRule[],
  packRules: readonly CompiledRule[],
): MergeRulesResult {
  const localByHash = new Map<string, CompiledRule>();
  for (const rule of localRules) {
    localByHash.set(rule.lessonHash, rule);
  }

  const merged: CompiledRule[] = [];
  const blocks: ImmutableOverrideBlock[] = [];
  const consumedLocalHashes = new Set<string>();

  for (const packRule of packRules) {
    const localRule = localByHash.get(packRule.lessonHash);
    if (!localRule) {
      // No local override — pack rule lands as-is.
      merged.push(packRule);
      continue;
    }

    consumedLocalHashes.add(packRule.lessonHash);

    const isEnforcedImmutable =
      packRule.immutable === true && (packRule.severity ?? 'warning') === 'error';

    if (!isEnforcedImmutable) {
      // ADR-085 default: local overrides pack byte-for-byte.
      merged.push(localRule);
      continue;
    }

    // Immutable carve-out (ADR-089). Start from the local rule, then
    // force severity and clear archive status if the local attempted
    // either of those. An omitted `localRule.severity` is NOT treated as
    // a downgrade attempt — the local override is opting out of
    // opinionating on severity, not declaring a lower one. Only an
    // explicit `'warning'` counts. (Runtime severity defaults vary
    // across consumers; finding.ts defaults to 'error' while
    // compile-lesson.ts defaults to 'warning', so inferring a downgrade
    // from absence would produce bogus blocks.)
    const attemptedSeverityDowngrade = localRule.severity === 'warning';
    const attemptedArchive = localRule.status === 'archived';

    if (attemptedSeverityDowngrade || attemptedArchive) {
      const attemptedChange: ImmutableOverrideBlock['attemptedChange'] =
        attemptedSeverityDowngrade && attemptedArchive
          ? 'both'
          : attemptedSeverityDowngrade
            ? 'severity-downgrade'
            : 'archive';
      const block: ImmutableOverrideBlock = {
        lessonHash: packRule.lessonHash,
        lessonHeading: packRule.lessonHeading,
        attemptedChange,
        enforcedSeverity: 'error',
      };
      if (attemptedSeverityDowngrade) {
        block.attemptedSeverity = 'warning';
      }
      blocks.push(block);
    }

    // Build the enforced rule. Preserve the local rule's pattern / body
    // (immutable protects severity, not code content), but force the
    // pack's severity and clear any archive flag. Preserve local
    // `archivedReason` removal by not copying the field forward.
    const enforced: CompiledRule = {
      ...localRule,
      severity: 'error',
      immutable: true,
    };
    if (enforced.status === 'archived') {
      enforced.status = 'active';
      delete enforced.archivedReason;
    }
    merged.push(enforced);
  }

  // Emit local-only rules that no pack rule claimed.
  for (const rule of localRules) {
    if (!consumedLocalHashes.has(rule.lessonHash)) {
      merged.push(rule);
    }
  }

  return { rules: merged, blocks };
}
