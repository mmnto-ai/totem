// ─── ADR-112 §5.2 — pre-window fixture ancestry (the #2294-couple leakage ruling) ─
//
// The operator-ruled fixture legality (option (a), recorded on strategy#810):
// a `positiveFixtures.pr` is legal iff `∉ heldOutPrs` AND (`∈ trainPrs` OR
// STRICTLY PRE-WINDOW). "Strictly pre-window" is an ANCESTRY fact — the PR's
// merge commit is an ancestor of the frozen split's `cutBoundarySha` — never a
// PR-number comparison (PR numbers are not merge-ordered: a long-lived
// low-number PR can merge late, i.e. post-window).
//
// This module is the ONE derivation home (Tenet-20) for the verified set. It is
// pure given its inputs; the GIT facts arrive as data (`mergeCommitByPr` from
// the full lc enumeration at the artifact's `asOfCommit`) plus one injected
// predicate (`isAncestor`, bound to the lc clone at the command layer). The
// git-free consumers (intake, the pure freeze gates, the §6 deriver) receive
// the RESULT, never the proof machinery — the same seam as `freezeBinding`.
//
// Soundness: held-out members DESCEND from the cut boundary, so a correct
// ancestry check can never admit them — but the downstream gates still check
// held-out membership FIRST and never let the verified set override it
// (defense-in-depth; FM (c) is the load-bearing condition). A PR that cannot
// be resolved to a merge commit (absent from the enumeration — e.g. merged
// AFTER `asOfCommit`) is simply NOT verified: the downstream gate rejects it
// loudly as unproven, which is the ruled fail-loud direction for the
// post-window door.

export interface VerifyPreWindowInputs {
  /** Every declared positive-fixture PR (duplicates fine; membership decides candidacy). */
  fixturePrs: readonly number[];
  /** The frozen split's train slice (members need no ancestry proof). */
  trainPrs: readonly number[];
  /** The frozen split's held-out slice (members are NEVER candidates — FM (c)). */
  heldOutPrs: readonly number[];
  /** PR → merge commit, from the full lc enumeration at the artifact's `asOfCommit`. */
  mergeCommitByPr: ReadonlyMap<number, string>;
  /** `true` iff the commit is an ancestor of the frozen split's `cutBoundarySha`. */
  isAncestorOfCutBoundary: (mergeCommit: string) => boolean;
}

/**
 * Derive the set of fixture PRs proven STRICTLY PRE-WINDOW: outside the window
 * (∉ train ∪ heldOut) with a resolvable merge commit that is an ancestor of the
 * cut boundary. Train/held-out members are never in the result (train needs no
 * proof; held-out must fail the gate as held-out, not ride an ancestry set).
 */
export function verifyPreWindowFixturePrs(inputs: VerifyPreWindowInputs): ReadonlySet<number> {
  const train = new Set(inputs.trainPrs);
  const heldOut = new Set(inputs.heldOutPrs);
  const verified = new Set<number>();
  for (const pr of new Set(inputs.fixturePrs)) {
    if (train.has(pr) || heldOut.has(pr)) continue;
    const mergeCommit = inputs.mergeCommitByPr.get(pr);
    if (mergeCommit === undefined) continue; // unresolvable ⇒ unproven ⇒ gate rejects loudly
    if (inputs.isAncestorOfCutBoundary(mergeCommit)) verified.add(pr);
  }
  return verified;
}
