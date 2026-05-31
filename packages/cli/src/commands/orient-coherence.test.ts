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
  it('flags active cards whose linked issue is absent from the open set', () => {
    const board: BoardItem[] = [
      { status: 'In Progress', title: 'Card A', contentNumber: 100 },
      { status: 'In Review', title: 'Card B', contentNumber: 200 },
    ];
    const open = new Set([200]); // #100 is closed/absent
    expect(flagBoardIssueDrift(board, open)).toEqual([
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
      { status: 'Done', title: 'Done card', contentNumber: 1 },
      { status: 'Todo', title: 'Todo card', contentNumber: 2 },
      { status: 'Backlog', title: 'Backlog card', contentNumber: 3 },
    ];
    expect(flagBoardIssueDrift(board, new Set())).toEqual([]);
  });

  it('does not flag cards whose issue is still open', () => {
    const board: BoardItem[] = [{ status: 'In Progress', title: 'A', contentNumber: 5 }];
    expect(flagBoardIssueDrift(board, new Set([5]))).toEqual([]);
  });

  it('ignores active cards with no linked issue number (draft cards)', () => {
    const board: BoardItem[] = [{ status: 'In Progress', title: 'Draft card' }];
    expect(flagBoardIssueDrift(board, new Set())).toEqual([]);
  });

  it('issues ZERO gh/exec calls — it is a pure function of its arguments', async () => {
    // Spy on safeExec at the core boundary; the predicate must never touch it.
    const core = await import('@mmnto/totem');
    const spy = vi.spyOn(core, 'safeExec');
    const board: BoardItem[] = [{ status: 'In Progress', title: 'A', contentNumber: 9 }];
    flagBoardIssueDrift(board, new Set());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
