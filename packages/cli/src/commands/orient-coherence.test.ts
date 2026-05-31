import { describe, expect, it, vi } from 'vitest';

import type { BoardItem } from '../adapters/github-cli-project.js';
import { flagBoardIssueDrift, isActiveBoardItem } from './orient-coherence.js';

describe('isActiveBoardItem', () => {
  it.each([
    ['Todo', false],
    ['todo', false],
    ['Done', false],
    ['Closed', false],
    ['Informs', false],
    ['Backlog', false],
    ['In Progress', true],
    ['In Review', true],
    ['Up Next', true],
  ])('status %s → active=%s', (status, active) => {
    expect(isActiveBoardItem({ status, title: 't' })).toBe(active);
  });

  it('treats an absent status as Todo (inactive)', () => {
    expect(isActiveBoardItem({ title: 't' })).toBe(false);
  });
});

describe('flagBoardIssueDrift', () => {
  const LOCAL = 'mmnto-ai/totem';
  /** Build a same-repo Issue card (the only kind that can drift) unless overridden. */
  const issueCard = (over: Partial<BoardItem>): BoardItem => ({
    status: 'In Progress',
    title: 'Card',
    contentRepo: LOCAL,
    contentType: 'Issue',
    ...over,
  });

  it('flags active same-repo Issue cards whose linked issue is absent from the open set', () => {
    const board: BoardItem[] = [
      issueCard({ title: 'Card A', contentNumber: 100 }),
      issueCard({ title: 'Card B', contentNumber: 200, status: 'In Review' }),
    ];
    const open = new Set([200]); // #100 is closed/absent
    expect(flagBoardIssueDrift(board, open, LOCAL)).toEqual([
      {
        boardItemTitle: 'Card A',
        boardStatus: 'In Progress',
        issueNumber: 100,
        kind: 'issue-closed-or-absent',
      },
    ]);
  });

  it('never flags terminal-status cards even when their issue is absent', () => {
    const board: BoardItem[] = [
      issueCard({ status: 'Done', title: 'Done card', contentNumber: 1 }),
      issueCard({ status: 'Todo', title: 'Todo card', contentNumber: 2 }),
      issueCard({ status: 'Backlog', title: 'Backlog card', contentNumber: 3 }),
    ];
    expect(flagBoardIssueDrift(board, new Set(), LOCAL)).toEqual([]);
  });

  it('does not flag cards whose issue is still open', () => {
    const board: BoardItem[] = [issueCard({ title: 'A', contentNumber: 5 })];
    expect(flagBoardIssueDrift(board, new Set([5]), LOCAL)).toEqual([]);
  });

  it('ignores active cards with no linked issue number (draft cards)', () => {
    const board: BoardItem[] = [
      { status: 'In Progress', title: 'Draft card', contentType: 'DraftIssue' },
    ];
    expect(flagBoardIssueDrift(board, new Set(), LOCAL)).toEqual([]);
  });

  // Regression: org-level boards span repos. A card for ANOTHER repo's issue must
  // NOT be flagged against this repo's open-issue set (the #2044 controller-review bug).
  it('never flags cross-repo cards (org board spanning repos)', () => {
    const board: BoardItem[] = [
      issueCard({
        title: 'Strategy card',
        contentNumber: 433,
        contentRepo: 'mmnto-ai/totem-strategy',
      }),
    ];
    // #433 is absent from THIS repo's open set, but it's a strategy issue → not drift here.
    expect(flagBoardIssueDrift(board, new Set(), LOCAL)).toEqual([]);
  });

  // A PR card's number lives in a different namespace than the open-ISSUE set;
  // comparing it would always false-flag. PR cards are never issue-drift.
  it('never flags PullRequest cards', () => {
    const board: BoardItem[] = [
      issueCard({ title: 'PR card', contentNumber: 2049, contentType: 'PullRequest' }),
    ];
    expect(flagBoardIssueDrift(board, new Set(), LOCAL)).toEqual([]);
  });

  it('derives NO coherence when the repo is undetermined (localSlug null)', () => {
    const board: BoardItem[] = [issueCard({ title: 'A', contentNumber: 7 })];
    expect(flagBoardIssueDrift(board, new Set(), null)).toEqual([]);
  });

  it('issues ZERO gh/exec calls — it is a pure function of its arguments', async () => {
    // Spy on safeExec at the core boundary; the predicate must never touch it.
    const core = await import('@mmnto/totem');
    const spy = vi.spyOn(core, 'safeExec');
    const board: BoardItem[] = [issueCard({ title: 'A', contentNumber: 9 })];
    flagBoardIssueDrift(board, new Set(), LOCAL);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
