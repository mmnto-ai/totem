import { execFileSync } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

import { GitHubCliAdapter } from './github-cli.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  execFile: vi.fn(),
  execSync: vi.fn(),
}));

const mockedExec = vi.mocked(execFileSync);

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
});
