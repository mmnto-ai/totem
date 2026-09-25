import { describe, expect, it, vi } from 'vitest';

import { safeExec } from '@mmnto/totem';

import { GitHubCliAdapter } from './github-cli.js';

// Mock safeExec at the @mmnto/totem boundary (mmnto/totem#1329).
// See gh-utils.test.ts for the full rationale.
vi.mock('@mmnto/totem', async () => {
  const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
  return {
    ...actual,
    safeExec: vi.fn(),
  };
});

const mockedExec = vi.mocked(safeExec);

describe('GitHubCliAdapter', () => {
  const adapter = new GitHubCliAdapter('/test/cwd');

  describe('fetchIssue', () => {
    it('maps gh output to StandardIssue format', () => {
      mockedExec.mockReturnValue(
        JSON.stringify({
          number: 42,
          title: 'Fix the thing',
          body: 'Detailed description',
          labels: [{ name: 'bug' }, { name: 'P1' }],
          state: 'OPEN',
        }),
      );
      const result = adapter.fetchIssue(42);
      expect(result).toEqual({
        number: 42,
        title: 'Fix the thing',
        body: 'Detailed description',
        state: 'OPEN',
        labels: ['bug', 'P1'],
      });
    });

    it('normalizes null body to empty string', () => {
      mockedExec.mockReturnValue(
        JSON.stringify({
          number: 1,
          title: 'No body',
          body: null,
          labels: [],
          state: 'OPEN',
        }),
      );
      expect(adapter.fetchIssue(1).body).toBe('');
    });

    it('maps labels to string array', () => {
      mockedExec.mockReturnValue(
        JSON.stringify({
          number: 1,
          title: 'test',
          body: '',
          labels: [{ name: 'enhancement' }, { name: 'P2' }, { name: 'architecture' }],
          state: 'OPEN',
        }),
      );
      expect(adapter.fetchIssue(1).labels).toEqual(['enhancement', 'P2', 'architecture']);
    });

    // greptile on mmnto-ai/totem#2965: the failure hint is measured where it is
    // built — a failing fetch names the repository it looked in, and its hint
    // puts the wrong-repository check before authentication.
    it('a failing fetch names the repository it looked in, and the hint puts a wrong repository before authentication', () => {
      const ghFailure = () => {
        throw new Error('gh: GraphQL: Could not resolve to an Issue with the number of 9.');
      };
      const named = new GitHubCliAdapter('/test/cwd', 'other-org/broken');
      mockedExec.mockImplementationOnce(ghFailure);
      let thrown: unknown;
      try {
        named.fetchIssue(9);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      const { message, recoveryHint } = thrown as Error & { recoveryHint: string };
      expect(message).toContain('Failed to fetch issue #9 in other-org/broken');
      expect(recoveryHint).toContain('Check that issue #9 exists in other-org/broken');
      expect(recoveryHint.indexOf('exists in other-org/broken')).toBeLessThan(
        recoveryHint.indexOf('gh auth status'),
      );
      // The working directory's adapter says "this repository", in the same order.
      mockedExec.mockImplementationOnce(ghFailure);
      let cwdThrown: unknown;
      try {
        adapter.fetchIssue(9);
      } catch (err) {
        cwdThrown = err;
      }
      const cwdHint = (cwdThrown as Error & { recoveryHint: string }).recoveryHint;
      expect(cwdHint).toContain('Check that issue #9 exists in this repository');
      expect(cwdHint.indexOf('exists in this repository')).toBeLessThan(
        cwdHint.indexOf('gh auth status'),
      );
    });
  });

  describe('fetchOpenIssues', () => {
    it('returns mapped issue list items', () => {
      mockedExec.mockReturnValue(
        JSON.stringify([
          {
            number: 1,
            title: 'First',
            labels: [{ name: 'bug' }],
            updatedAt: '2026-03-01T00:00:00Z',
          },
          {
            number: 2,
            title: 'Second',
            labels: [],
            updatedAt: '2026-03-02T00:00:00Z',
          },
        ]),
      );
      const result = adapter.fetchOpenIssues();
      expect(result).toEqual([
        { number: 1, title: 'First', labels: ['bug'], updatedAt: '2026-03-01T00:00:00Z' },
        { number: 2, title: 'Second', labels: [], updatedAt: '2026-03-02T00:00:00Z' },
      ]);
    });

    it('returns empty array when no open issues', () => {
      mockedExec.mockReturnValue('[]');
      expect(adapter.fetchOpenIssues()).toEqual([]);
    });

    it('throws on invalid JSON', () => {
      mockedExec.mockReturnValue('not json');
      expect(() => adapter.fetchOpenIssues()).toThrow('GitHub CLI returned invalid JSON');
    });

    it('throws install message when gh is not found', () => {
      mockedExec.mockImplementation(() => {
        throw new Error('ENOENT');
      });
      expect(() => adapter.fetchOpenIssues()).toThrow('GitHub CLI (gh) is required');
    });
  });

  describe('fetchOpenIssuesWithBody', () => {
    it('returns mapped issue items including body', () => {
      mockedExec.mockReturnValue(
        JSON.stringify([
          {
            number: 10,
            title: 'Epic',
            body: 'parent stuff',
            labels: [{ name: 'type: epic' }],
          },
          { number: 11, title: 'Child', body: '**Parent:** #10', labels: [] },
        ]),
      );
      const result = adapter.fetchOpenIssuesWithBody();
      expect(result).toEqual([
        { number: 10, title: 'Epic', body: 'parent stuff', labels: ['type: epic'] },
        { number: 11, title: 'Child', body: '**Parent:** #10', labels: [] },
      ]);
    });

    it('normalizes null body to empty string', () => {
      mockedExec.mockReturnValue(
        JSON.stringify([{ number: 1, title: 'No body', body: null, labels: [] }]),
      );
      expect(adapter.fetchOpenIssuesWithBody()[0]!.body).toBe('');
    });

    it('returns empty array when no open issues', () => {
      mockedExec.mockReturnValue('[]');
      expect(adapter.fetchOpenIssuesWithBody()).toEqual([]);
    });
  });
});
