import { execFileSync } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

import { GitHubCliPrAdapter } from './github-cli-pr.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  execFile: vi.fn(),
  execSync: vi.fn(),
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

  describe('fetchCodeScanningAlerts', () => {
    it('maps gh API output to StandardCodeScanAlert format', () => {
      // First call: getRepoNwo
      mockedExec.mockReturnValueOnce('mmnto-ai/totem\n');
      // Second call: code scanning alerts
      mockedExec.mockReturnValueOnce(
        JSON.stringify([
          {
            number: 10,
            rule: { id: 'js/unused-variable', severity: 'warning', description: 'Unused var' },
            state: 'fixed',
            dismissed_reason: null,
            html_url: 'https://github.com/mmnto-ai/totem/security/code-scanning/10',
            most_recent_instance: {
              ref: 'refs/heads/feat/fix-stuff',
              location: { path: 'src/utils.ts', start_line: 42, end_line: 42 },
              message: { text: 'Unused variable tmp' },
              classifications: [],
            },
            created_at: '2026-03-01T00:00:00Z',
            tool: { name: 'CodeQL' },
          },
        ]),
      );

      const result = adapter.fetchCodeScanningAlerts('refs/heads/feat/fix-stuff');
      expect(result).toEqual([
        {
          number: 10,
          rule_id: 'js/unused-variable',
          state: 'fixed',
          dismissed_reason: undefined,
          html_url: 'https://github.com/mmnto-ai/totem/security/code-scanning/10',
          most_recent_instance: {
            location: { path: 'src/utils.ts', start_line: 42 },
            message: { text: 'Unused variable tmp' },
          },
        },
      ]);
    });

    it('handles extra fields via passthrough (lenient schema)', () => {
      mockedExec.mockReturnValueOnce('mmnto-ai/totem\n');
      mockedExec.mockReturnValueOnce(
        JSON.stringify([
          {
            number: 20,
            rule: { id: 'sql/injection', severity: 'error', tags: ['security'] },
            state: 'open',
            html_url: 'https://github.com/mmnto-ai/totem/security/code-scanning/20',
            most_recent_instance: {
              location: { path: 'src/db.ts', start_line: 5, end_column: 30 },
              message: { text: 'SQL injection risk' },
              extra_field: 'should be ignored',
            },
            unknown_top_level: true,
          },
        ]),
      );

      const result = adapter.fetchCodeScanningAlerts('refs/heads/main');
      expect(result).toHaveLength(1);
      expect(result[0]!.rule_id).toBe('sql/injection');
      expect(result[0]!.state).toBe('open');
    });

    it('returns empty array when no alerts', () => {
      mockedExec.mockReturnValueOnce('mmnto-ai/totem\n');
      mockedExec.mockReturnValueOnce('[]');

      const result = adapter.fetchCodeScanningAlerts('refs/heads/main');
      expect(result).toEqual([]);
    });
  });
});
