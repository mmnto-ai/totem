import { z } from 'zod';

import { getTagDate } from '../git.js';
import { ghFetchAndParse } from './gh-utils.js';
import type { IssueAdapter, StandardIssue, StandardIssueListItem } from './issue-adapter.js';

export interface ClosedIssueListItem {
  number: number;
  title: string;
  closedAt: string;
}

// ─── Zod schemas for GitHub CLI JSON output ─────────────

const GhIssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  labels: z.array(z.object({ name: z.string() })),
  state: z.string(),
});

const GhIssueListItemSchema = z.object({
  number: z.number(),
  title: z.string(),
  labels: z.array(z.object({ name: z.string() })),
  updatedAt: z.string().datetime(),
});

const GhClosedIssueListItemSchema = z.object({
  number: z.number(),
  title: z.string(),
  closedAt: z.string().datetime(),
});

// ─── Adapter implementation ─────────────────────────────

const DEFAULT_ISSUE_LIMIT = 100;

export class GitHubCliAdapter implements IssueAdapter {
  private repoFlag: string[];

  /**
   * @param cwd Working directory for `gh` CLI
   * @param repo Optional `owner/repo` string. When set, `--repo` is passed to all `gh` commands.
   */
  constructor(
    private cwd: string,
    private repo?: string,
  ) {
    this.repoFlag = repo ? ['--repo', repo] : [];
  }

  fetchIssue(issueNumber: number): StandardIssue {
    const issue = ghFetchAndParse(
      [
        ...this.repoFlag,
        'issue',
        'view',
        String(issueNumber),
        '--json',
        'number,title,body,labels,state',
      ],
      GhIssueSchema,
      `issue #${issueNumber}`,
      this.cwd,
    );
    return {
      number: issue.number,
      title: issue.title,
      body: issue.body ?? '',
      state: issue.state,
      labels: issue.labels.map((l) => l.name),
      repo: this.repo,
    };
  }

  /**
   * Fetch recently closed issues, optionally filtered by search query (e.g., "closed:>2026-01-01").
   */
  fetchClosedIssues(limit: number = DEFAULT_ISSUE_LIMIT, sinceTag?: string): ClosedIssueListItem[] {
    const args = [
      ...this.repoFlag,
      'issue',
      'list',
      '--state',
      'closed',
      '--json',
      'number,title,closedAt',
      '--limit',
      String(limit),
    ];

    // If we have a tag, use --search to filter by close date
    if (sinceTag) {
      const tagDate = getTagDate(this.cwd, sinceTag);
      if (tagDate) {
        args.push('--search', `closed:>=${tagDate}`);
      }
    }

    const issues = ghFetchAndParse(
      args,
      z.array(GhClosedIssueListItemSchema),
      'closed issues',
      this.cwd,
    );
    return issues.map((i) => ({
      number: i.number,
      title: i.title,
      closedAt: i.closedAt,
    }));
  }

  fetchOpenIssues(limit: number = DEFAULT_ISSUE_LIMIT): StandardIssueListItem[] {
    const issues = ghFetchAndParse(
      [
        ...this.repoFlag,
        'issue',
        'list',
        '--state',
        'open',
        '--json',
        'number,title,labels,updatedAt',
        '--limit',
        String(limit),
      ],
      z.array(GhIssueListItemSchema),
      'open issues',
      this.cwd,
    );
    return issues.map((i) => ({
      number: i.number,
      title: i.title,
      labels: i.labels.map((l) => l.name),
      updatedAt: i.updatedAt,
      repo: this.repo,
    }));
  }
}
