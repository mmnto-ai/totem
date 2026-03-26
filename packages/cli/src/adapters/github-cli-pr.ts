import { z } from 'zod';

import { safeExec } from '@mmnto/totem';

import { GH_TIMEOUT_MS } from '../utils.js';
import { ghFetchAndParse, handleGhError } from './gh-utils.js';
import type {
  PrAdapter,
  StandardPr,
  StandardPrListItem,
  StandardReviewComment,
} from './pr-adapter.js';

// ─── Zod schemas for GitHub CLI JSON output ─────────────

const GhPrListItemSchema = z.object({
  number: z.number(),
  title: z.string(),
  headRefName: z.string(),
});

const GhPrSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.string(),
  comments: z.array(
    z.object({
      author: z.object({ login: z.string() }),
      body: z.string(),
    }),
  ),
  reviews: z.array(
    z.object({
      author: z.object({ login: z.string() }),
      state: z.string(),
      body: z.string(),
    }),
  ),
});

const GhReviewCommentSchema = z.object({
  id: z.number(),
  user: z.object({ login: z.string() }),
  body: z.string(),
  path: z.string(),
  diff_hunk: z.string(),
  in_reply_to_id: z.number().optional(),
  created_at: z.string().optional(),
});

// ─── Adapter implementation ─────────────────────────────

export class GitHubCliPrAdapter implements PrAdapter {
  constructor(private cwd: string) {}

  fetchOpenPRs(): StandardPrListItem[] {
    const prs = ghFetchAndParse(
      ['pr', 'list', '--state', 'open', '--json', 'number,title,headRefName'],
      z.array(GhPrListItemSchema),
      'open PRs',
      this.cwd,
    );
    return prs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      headRefName: pr.headRefName,
    }));
  }

  fetchPr(prNumber: number): StandardPr {
    const pr = ghFetchAndParse(
      ['pr', 'view', String(prNumber), '--json', 'number,title,body,state,comments,reviews'],
      GhPrSchema,
      `PR #${prNumber}`,
      this.cwd,
    );
    return {
      number: pr.number,
      title: pr.title,
      body: pr.body ?? '',
      state: pr.state,
      comments: pr.comments.map((c) => ({ author: c.author.login, body: c.body })),
      reviews: pr.reviews.map((r) => ({ author: r.author.login, state: r.state, body: r.body })),
    };
  }

  fetchReviewComments(prNumber: number): StandardReviewComment[] {
    const nwo = this.getRepoNwo();
    const comments = ghFetchAndParse(
      ['api', `repos/${nwo}/pulls/${prNumber}/comments`, '--paginate'],
      z.array(GhReviewCommentSchema),
      `review comments for PR #${prNumber}`,
      this.cwd,
    );
    return comments.map((c) => ({
      id: c.id,
      author: c.user.login,
      body: c.body,
      path: c.path,
      diffHunk: c.diff_hunk,
      inReplyToId: c.in_reply_to_id,
      createdAt: c.created_at,
    }));
  }

  private getRepoNwo(): string {
    try {
      return safeExec('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
        cwd: this.cwd,
        timeout: GH_TIMEOUT_MS,
      });
    } catch (err) {
      handleGhError(err, 'repository info');
    }
  }
}
