import { beforeEach, describe, expect, it, vi } from 'vitest';

import { safeExec } from '@mmnto/totem';

import { fetchBoardItems } from './github-cli-project.js';

// Mock `safeExec` at the `@mmnto/totem` boundary (same rationale as
// gh-utils.test.ts): these tests verify the adapter's call signature and
// parsing contract, not safeExec's passthrough layer.
vi.mock('@mmnto/totem', async () => {
  const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
  return {
    ...actual,
    safeExec: vi.fn(),
  };
});

const mockedExec = vi.mocked(safeExec);

/**
 * Build a `gh project item-list --format json` response of `count` cards.
 * The TAIL card (the one a 200-capped fetch would drop, mmnto-ai/totem#2644)
 * is an active In Progress issue card; one mid-board card is a draft card
 * with no `content` (the shape gh emits for drafts).
 */
function boardResponse(count: number, totalCount?: number): string {
  const items = Array.from({ length: count }, (_, idx) => {
    const n = idx + 1;
    if (n === 3) {
      // Draft card: no linked content at all.
      return { status: 'Todo', title: `draft card ${n}` };
    }
    const isTail = n === count;
    return {
      status: isTail ? 'In Progress' : 'Done',
      title: `card ${n}`,
      content: { number: n, repository: 'mmnto-ai/totem', type: 'Issue' },
    };
  });
  return JSON.stringify(totalCount === undefined ? { items } : { items, totalCount });
}

describe('fetchBoardItems', () => {
  beforeEach(() => {
    mockedExec.mockReset();
  });

  it('requests a deliberately complete --limit (not the old 200 cap)', () => {
    mockedExec.mockReturnValue(boardResponse(5, 5));
    fetchBoardItems('mmnto-ai', 1, '/repo');
    const args = mockedExec.mock.calls[0]?.[1] as string[];
    const limitValue = args[args.indexOf('--limit') + 1];
    // Pinned on purpose: changing the page budget must be a conscious edit here
    // too — the fixture below only proves completeness up to this budget.
    expect(limitValue).toBe('1000');
  });

  it('parses a >200-card board in full — the active tail card survives (#2644)', () => {
    mockedExec.mockReturnValue(boardResponse(227, 227));
    const items = fetchBoardItems('mmnto-ai', 1, '/repo');
    expect(items).toHaveLength(227);
    const tail = items[226];
    expect(tail).toMatchObject({
      status: 'In Progress',
      title: 'card 227',
      contentNumber: 227,
      contentRepo: 'mmnto-ai/totem',
      contentType: 'Issue',
    });
    // Draft card maps with all content fields honestly absent.
    expect(items[2]).toMatchObject({ title: 'draft card 3' });
    expect(items[2].contentNumber).toBeUndefined();
    expect(items[2].contentType).toBeUndefined();
  });

  it('fails loud when the response is truncated (items < totalCount)', () => {
    mockedExec.mockReturnValue(boardResponse(3, 227));
    expect(() => fetchBoardItems('mmnto-ai', 1, '/repo')).toThrow(
      /truncated: fetched 3 of 227 cards/,
    );
  });

  it('tolerates an absent totalCount (older gh) — no truncation signal, no throw', () => {
    mockedExec.mockReturnValue(boardResponse(2));
    const items = fetchBoardItems('mmnto-ai', 1, '/repo');
    expect(items).toHaveLength(2);
  });
});
