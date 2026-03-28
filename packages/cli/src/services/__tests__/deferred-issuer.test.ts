import { describe, expect, it, vi } from 'vitest';

import type { PrAdapter } from '../../adapters/pr-adapter.js';
import type { CommentThread } from '../../parsers/bot-review-parser.js';
import { createDeferredIssue, isAlreadyDeferred } from '../deferred-issuer.js';

// ─── Helpers ───────────────────────────────────────────

function makeMockAdapter(issueUrl = 'https://github.com/owner/repo/issues/42') {
  return {
    fetchOpenPRs: () => [],
    fetchPr: () => ({
      number: 1,
      title: '',
      body: '',
      state: 'open' as const,
      comments: [],
      reviews: [],
    }),
    fetchReviewComments: () => [],
    createIssue: vi.fn().mockReturnValue(issueUrl),
    replyToComment: vi.fn(),
  } satisfies PrAdapter;
}

function makeThread(
  botBody: string,
  humanReplies: string[] = [],
  opts?: { path?: string; diffHunk?: string; rootId?: number },
): CommentThread {
  return {
    path: opts?.path ?? 'src/foo.ts',
    diffHunk: opts?.diffHunk ?? '@@ -1,3 +1,5 @@',
    comments: [
      { id: opts?.rootId ?? 100, author: 'coderabbitai[bot]', body: botBody },
      ...humanReplies.map((body) => ({ author: 'dev', body })),
    ],
  };
}

// ─── isAlreadyDeferred ─────────────────────────────────

describe('isAlreadyDeferred', () => {
  it('returns true when a comment contains "Deferred to #123"', () => {
    const thread = makeThread('some finding', ['Deferred to #123']);
    expect(isAlreadyDeferred(thread)).toBe(true);
  });

  it('returns true when a comment contains "Deferred to issue #456"', () => {
    const thread = makeThread('some finding', ['Deferred to issue #456']);
    expect(isAlreadyDeferred(thread)).toBe(true);
  });

  it('returns false when no deferred marker present', () => {
    const thread = makeThread('some finding', ['Will fix later']);
    expect(isAlreadyDeferred(thread)).toBe(false);
  });

  it('returns false for empty thread', () => {
    const thread: CommentThread = {
      path: 'src/foo.ts',
      diffHunk: '@@ -1,3 +1,5 @@',
      comments: [],
    };
    expect(isAlreadyDeferred(thread)).toBe(false);
  });
});

// ─── createDeferredIssue ───────────────────────────────

describe('createDeferredIssue', () => {
  it('creates issue with correct title, body, and labels', () => {
    const adapter = makeMockAdapter();
    const thread = makeThread('Missing error handler in async route');

    createDeferredIssue(adapter, 99, thread, '1.6.0');

    expect(adapter.createIssue).toHaveBeenCalledOnce();
    const call = adapter.createIssue.mock.calls[0]![0];
    expect(call.title).toBe('Deferred: Missing error handler in async route');
    expect(call.body).toContain('src/foo.ts');
    expect(call.body).toContain('#99');
    expect(call.body).toContain('coderabbitai[bot]');
    expect(call.labels).toEqual(['tech-debt', 'deferred']);
    expect(call.milestone).toBe('1.7.0');
  });

  it('replies on thread with "Deferred to #NNN"', () => {
    const adapter = makeMockAdapter();
    const thread = makeThread('Some finding', [], { rootId: 200 });

    createDeferredIssue(adapter, 99, thread, '1.6.0');

    expect(adapter.replyToComment).toHaveBeenCalledWith(99, 200, 'Deferred to #42');
  });

  it('skips if thread already deferred (idempotent)', () => {
    const adapter = makeMockAdapter();
    const thread = makeThread('Finding', ['Deferred to #10']);

    const result = createDeferredIssue(adapter, 99, thread, '1.6.0');

    expect(result.skipped).toBe(true);
    expect(adapter.createIssue).not.toHaveBeenCalled();
    expect(adapter.replyToComment).not.toHaveBeenCalled();
  });

  it('skips if no bot comment (empty thread)', () => {
    const adapter = makeMockAdapter();
    const thread: CommentThread = {
      path: 'src/foo.ts',
      diffHunk: '@@ -1,3 +1,5 @@',
      comments: [],
    };

    const result = createDeferredIssue(adapter, 99, thread, '1.6.0');

    expect(result.skipped).toBe(true);
    expect(adapter.createIssue).not.toHaveBeenCalled();
  });

  it('infers next milestone from current', () => {
    const adapter = makeMockAdapter();
    const thread = makeThread('Finding');

    createDeferredIssue(adapter, 99, thread, 'v2.0.0');

    const call = adapter.createIssue.mock.calls[0]![0];
    expect(call.milestone).toBe('v2.1.0');
  });

  it('handles replyToComment failure gracefully (issue still created)', () => {
    const adapter = makeMockAdapter();
    adapter.replyToComment.mockImplementation(() => {
      throw new Error('network timeout');
    });
    const thread = makeThread('Finding');
    const logs: string[] = [];

    const result = createDeferredIssue(adapter, 99, thread, '1.6.0', (msg) => logs.push(msg));

    expect(result.skipped).toBe(false);
    expect(result.issueUrl).toBe('https://github.com/owner/repo/issues/42');
    expect(adapter.createIssue).toHaveBeenCalledOnce();
    expect(logs.some((l) => l.includes('Failed to reply on thread'))).toBe(true);
  });
});
