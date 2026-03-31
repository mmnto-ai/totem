// totem-context: All methods are synchronous by design — safeExec is sync, handleGhError returns never. Do not flag missing await.

import { z } from 'zod';

import { safeExec } from '@mmnto/totem';

import { GH_TIMEOUT_MS } from '../utils.js';
import { ghExec, ghFetchAndParse, handleGhError } from './gh-utils.js';
import type {
  PrAdapter,
  StandardCodeScanAlert,
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

const GhCodeScanAlertSchema = z
  .object({
    number: z.number(),
    rule: z.object({ id: z.string() }).passthrough(),
    state: z.enum(['open', 'dismissed', 'fixed']),
    dismissed_reason: z.string().nullable().optional(),
    html_url: z.string(),
    most_recent_instance: z
      .object({
        location: z
          .object({
            path: z.string(),
            start_line: z.number(),
          })
          .passthrough(),
        message: z.object({ text: z.string() }).passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

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

  fetchCodeScanningAlerts(prNumber: number): StandardCodeScanAlert[] {
    const nwo = this.getRepoNwo();
    const alerts = ghFetchAndParse(
      ['api', `repos/${nwo}/code-scanning/alerts?pr=${prNumber}&per_page=100`, '--paginate'],
      z.array(GhCodeScanAlertSchema),
      `code scanning alerts for PR #${prNumber}`,
      this.cwd,
    );
    return alerts.map((a) => ({
      number: a.number,
      rule_id: a.rule.id,
      state: a.state,
      dismissed_reason: a.dismissed_reason ?? undefined,
      html_url: a.html_url,
      most_recent_instance: {
        location: {
          path: a.most_recent_instance.location.path,
          start_line: a.most_recent_instance.location.start_line,
        },
        message: { text: a.most_recent_instance.message.text },
      },
    }));
  }

  createIssue(params: {
    title: string;
    body: string;
    labels: string[];
    milestone?: string;
  }): string {
    const args = ['issue', 'create', '--title', params.title, '--body', params.body];
    for (const label of params.labels) {
      args.push('--label', label);
    }
    if (params.milestone) {
      args.push('--milestone', params.milestone);
    }
    try {
      return safeExec('gh', args, {
        cwd: this.cwd,
        timeout: GH_TIMEOUT_MS,
        env: { ...process.env, GH_PROMPT_DISABLED: '1' },
      }).trim();
    } catch (err) {
      handleGhError(err, 'issue creation');
    }
  }

  replyToComment(prNumber: number, commentId: number, body: string): void {
    const nwo = this.getRepoNwo();
    ghExec(
      [
        'api',
        `repos/${nwo}/pulls/comments/${commentId}/replies`,
        '-X',
        'POST',
        '-f',
        `body=${body}`,
      ],
      this.cwd,
    );
  }

  addPrComment(prNumber: number, body: string): void {
    ghExec(['pr', 'comment', String(prNumber), '--body', body], this.cwd);
  }

  private getRepoNwo(): string {
    try {
      return safeExec('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
        cwd: this.cwd,
        timeout: GH_TIMEOUT_MS,
        env: { ...process.env, GH_PROMPT_DISABLED: '1' },
      });
    } catch (err) {
      handleGhError(err, 'repository info');
    }
  }
}
