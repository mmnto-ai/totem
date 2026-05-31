// Pure board↔issue coherence predicate for `totem orient` (mmnto-ai/totem#2044).
//
// A board card in an ACTIVE status whose linked issue is NOT in the set of open
// issues is "drift" — the issue was closed (or never opened) but the card was
// left in flight. This is the one NEW derived signal orient adds on top of the
// primitives. It is intentionally PURE and separately unit-testable: it derives
// ONLY from the board items + the open-issue numbers orient already fetched, so
// it issues ZERO extra `gh` calls.

import type { BoardItem } from '../adapters/github-cli-project.js';

/** A board card flagged as out of sync with the open-issue set. */
export interface BoardIssueCoherenceFlag {
  boardItemTitle: string;
  /** The card's board status (always an active status — terminal cards are never flagged). */
  boardStatus: string;
  /** The linked issue number that is closed or absent from the open set. */
  issueNumber: number;
  kind: 'issue-closed-or-absent';
}

// Board "in-flight" = NOT a terminal/reference status. Shared by the command's
// board filter AND this coherence predicate so the human + --json surfaces and
// the drift check all honor ONE definition of "active". Ported from the seed
// (tools/orient.cjs) TERMINAL_STATUS.
export const TERMINAL_BOARD_STATUS = /^(todo|done|closed|informs|backlog)/i;

/** A board item is active when its status is not a terminal/reference status. Absent status ⇒ 'Todo' ⇒ inactive. */
export function isActiveBoardItem(item: BoardItem): boolean {
  return !TERMINAL_BOARD_STATUS.test(item.status || 'Todo');
}

/**
 * Flag active board cards whose linked issue is absent from THIS repo's open-issue set.
 *
 * Scoped to the current repo (`localSlug`) because GH Projects are commonly
 * ORG-level boards spanning multiple repos: a card for another repo's issue —
 * or a PR card, whose number lives in a different namespace than the issue set —
 * compared against this repo's open-ISSUE set would false-flag every healthy
 * cross-repo/PR card as "drift". A coherence sensor that cries wolf on healthy
 * cards is worse than none, so the gate is deliberately conservative (derive no
 * coherence rather than wrong coherence):
 * - ONLY active-status cards (terminal-status cards are never flagged).
 * - ONLY cards whose `contentRepo` is THIS repo; cross-repo / repo-unknown cards skipped.
 * - ONLY `Issue`-type cards; PR cards and draft cards (no number) skipped.
 * - Pure: derives solely from its arguments — issues NO `gh` calls.
 *
 * @param localSlug current repo as `owner/repo`; null (repo undetermined) ⇒ NO
 *   coherence is derived, because an unscoped check can only be wrong.
 */
export function flagBoardIssueDrift(
  boardItems: BoardItem[],
  openIssueNumbers: ReadonlySet<number>,
  localSlug: string | null,
): BoardIssueCoherenceFlag[] {
  const flags: BoardIssueCoherenceFlag[] = [];
  if (!localSlug) return flags;
  for (const item of boardItems) {
    if (!isActiveBoardItem(item)) continue;
    const issueNumber = item.contentNumber;
    if (issueNumber === undefined) continue;
    // Org-board guard: only THIS repo's Issue cards can drift against its issue set.
    // Case-folded compare — GitHub owner/repo slugs are case-insensitive, so a casing
    // skew between `gh repo view` and `gh project item-list` must not drop a valid check.
    if (!item.contentRepo || item.contentRepo.toLowerCase() !== localSlug.toLowerCase()) continue;
    if (item.contentType !== 'Issue') continue;
    if (openIssueNumbers.has(issueNumber)) continue;
    flags.push({
      boardItemTitle: item.title,
      boardStatus: item.status || 'Todo',
      issueNumber,
      kind: 'issue-closed-or-absent',
    });
  }
  return flags;
}
