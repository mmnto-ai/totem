/**
 * The `legs-owed` predicate — the minimal, first verdict of the routing seam
 * `totem route` will grow into (mmnto-ai/totem#2534; carried here per
 * strategy-claude's 2026-09-02 concurrence: "carry the minimal `legs-owed`
 * predicate behind the same seam; do not wait on `totem route`").
 *
 * Scope discipline is the point of this module. It answers exactly one
 * question — *does this changed-file set owe a falsification leg?* — and
 * returns the verdict WITH ITS BASIS, which is the shape #2534's other
 * verdicts (judgment-dense, safe-harbor, regime state) will also take. There
 * is nothing gate-shaped here: no exit codes, no printing, no config loading,
 * no filesystem, no git. The gate composes those; when `totem route` lands it
 * GROWS this module rather than minting a second classifier that could
 * disagree with the one the hook already trusts.
 *
 * Judgment-density is derived from FILE CLASS, per `doctrine/model-tiering.md`
 * § Fable-absent regime item 1 — doctrine surfaces, public-copy surfaces, or a
 * contract class. A path glob is the honest mechanism for that; a line-count
 * floor is only a proxy and was ruled out.
 */

import { matchesGlob } from '../sys/glob.js';

/**
 * The default judgment-dense path floor (mmnto-ai/totem#2698 OQ4, ruled).
 *
 * The doctrine floor (`doctrine/**`, `design-tenets.md`, `adr/**`,
 * `proposals/**`) plus the public-copy surfaces (`README.md`,
 * `docs/wiki/**`) plus one contract proxy: `.changeset/**`. A changeset IS
 * the release's compatibility contract, so every releasable slice is owed a
 * leg BY DERIVATION rather than by anyone remembering to declare it — which
 * is what keeps a package repo from shipping the claim-without-mechanism
 * shape. A repo's own contract classes (its schemas, its hook builders, its
 * skills) are declared per repo in `hooks.legsOwed.globs`, which REPLACES
 * this list when present.
 */
export const DEFAULT_LEGS_OWED_GLOBS = [
  'doctrine/**',
  'design-tenets.md',
  'adr/**',
  'proposals/**',
  'README.md',
  'docs/wiki/**',
  '.changeset/**',
] as const;

/** One reason a file is owed: the positive glob that matched, and the file. */
export interface LegsOwedBasisEntry {
  glob: string;
  file: string;
}

export interface LegsOwedVerdict {
  /** True iff at least one file matched a positive glob and no negative. */
  owed: boolean;
  /**
   * EVERY (positive glob, file) match among owed files, in input order —
   * files outer, globs inner. The caller prints a prefix and a count; the
   * basis is complete here so nothing about the verdict is unexplained.
   */
  basis: LegsOwedBasisEntry[];
}

/**
 * Classify a changed-file set against the configured globs. Pure: same inputs,
 * same verdict, no ambient state.
 *
 * Matching uses `matchesGlob` — the SAME dialect `fileMatchesGlobs` (and hence
 * `ignorePatterns`) already uses, deliberately, so a repo author writes one
 * kind of glob for this repo and never a second. Negation follows the same
 * rule: a `!`-prefixed glob is an exclusion, and a file matching ANY negative
 * is never owed, whatever positives it also matched — a carve-out that a
 * positive could override would not be a carve-out.
 *
 * An empty `changedFiles` (or a globs list with no positives) is not owed:
 * there is nothing for a leg to read.
 */
export function classifyLegsOwed(
  changedFiles: readonly string[],
  globs: readonly string[],
): LegsOwedVerdict {
  const negatives = globs.filter((glob) => glob.startsWith('!'));
  const positives = globs.filter((glob) => !glob.startsWith('!'));
  const basis: LegsOwedBasisEntry[] = [];

  for (const file of changedFiles) {
    if (negatives.some((glob) => matchesGlob(file, glob.slice(1)))) continue;
    for (const glob of positives) {
      if (matchesGlob(file, glob)) basis.push({ glob, file });
    }
  }

  return { owed: basis.length > 0, basis };
}
