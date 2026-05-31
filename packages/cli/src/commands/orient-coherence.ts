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
 * Flag active board cards whose linked issue is absent from the open-issue set.
 *
 * - Considers ONLY active-status cards (terminal-status cards are never flagged).
 * - Considers ONLY cards with a linked `contentNumber` (draft cards / PR-backed
 *   cards without an issue number cannot drift against the issue set).
 * - Pure: derives solely from its two arguments — issues NO `gh` calls.
 */
export function flagBoardIssueDrift(
  boardItems: BoardItem[],
  openIssueNumbers: ReadonlySet<number>,
): BoardIssueCoherenceFlag[] {
  const flags: BoardIssueCoherenceFlag[] = [];
  for (const item of boardItems) {
    if (!isActiveBoardItem(item)) continue;
    const issueNumber = item.contentNumber;
    if (issueNumber === undefined) continue;
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
