import { execFileSync } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

import { GitHubCliPrAdapter } from './github-cli-pr.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExec = vi.mocked(execFileSync);

describe('GitHubCliPrAdapter', () => {
  const adapter = new GitHubCliPrAdapter('/test/cwd');

  describe('fetchOpenPRs', () => {
    it('returns mapped PR list items', () => {
      mockedExec.mockReturnValue(
        JSON.stringify([
          { number: 1, title: 'feat: add stuff', headRefName: 'feat/add-stuff' },
          { number: 2, title: 'fix: bug', headRefName: 'fix/bug' },
        ]),
      );
      const result = adapter.fetchOpenPRs();
      expect(result).toEqual([
        { number: 1, title: 'feat: add stuff', headRefName: 'feat/add-stuff' },
        { number: 2, title: 'fix: bug', headRefName: 'fix/bug' },
      ]);
    });

    it('returns empty array when no open PRs', () => {
      mockedExec.mockReturnValue('[]');
      expect(adapter.fetchOpenPRs()).toEqual([]);
    });
  });

  describe('fetchPr', () => {
    it('maps gh output to StandardPr format', () => {
      mockedExec.mockReturnValue(
        JSON.stringify({
          number: 42,
          title: 'feat: big feature',
          body: 'Description here',
          state: 'OPEN',
          comments: [{ author: { login: 'alice' }, body: 'LGTM' }],
          reviews: [{ author: { login: 'bob' }, state: 'APPROVED', body: 'Looks good' }],
        }),
      );
      const result = adapter.fetchPr(42);
      expect(result).toEqual({
        number: 42,
        title: 'feat: big feature',
        body: 'Description here',
        state: 'OPEN',
        comments: [{ author: 'alice', body: 'LGTM' }],
        reviews: [{ author: 'bob', state: 'APPROVED', body: 'Looks good' }],
      });
    });

    it('normalizes null body to empty string', () => {
      mockedExec.mockReturnValue(
        JSON.stringify({
          number: 1,
          title: 'test',
          body: null,
          state: 'OPEN',
          comments: [],
          reviews: [],
        }),
      );
      expect(adapter.fetchPr(1).body).toBe('');
    });
  });

  describe('fetchReviewComments', () => {
    it('maps gh API output to StandardReviewComment format', () => {
      // First call: getRepoNwo
      mockedExec.mockReturnValueOnce('mmnto-ai/totem\n');
      // Second call: fetchReviewComments
      mockedExec.mockReturnValueOnce(
        JSON.stringify([
          {
            id: 100,
            user: { login: 'reviewer' },
            body: 'Fix this',
            path: 'src/index.ts',
            diff_hunk: '@@ -1,3 +1,4 @@',
            in_reply_to_id: undefined,
            created_at: '2026-03-01T00:00:00Z',
          },
          {
            id: 101,
            user: { login: 'author' },
            body: 'Done',
            path: 'src/index.ts',
            diff_hunk: '@@ -1,3 +1,4 @@',
            in_reply_to_id: 100,
            created_at: '2026-03-01T01:00:00Z',
          },
        ]),
      );

      const result = adapter.fetchReviewComments(42);
      expect(result).toEqual([
        {
          id: 100,
          author: 'reviewer',
          body: 'Fix this',
          path: 'src/index.ts',
          diffHunk: '@@ -1,3 +1,4 @@',
          inReplyToId: undefined,
          createdAt: '2026-03-01T00:00:00Z',
        },
        {
          id: 101,
          author: 'author',
          body: 'Done',
          path: 'src/index.ts',
          diffHunk: '@@ -1,3 +1,4 @@',
          inReplyToId: 100,
          createdAt: '2026-03-01T01:00:00Z',
        },
      ]);
    });
  });
});
