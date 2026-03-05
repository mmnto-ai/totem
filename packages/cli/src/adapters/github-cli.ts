import { z } from 'zod';

import type { IssueAdapter, StandardIssue, StandardIssueListItem } from './issue-adapter.js';
import { ghFetchAndParse } from './gh-utils.js';

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

// ─── Adapter implementation ─────────────────────────────

const DEFAULT_ISSUE_LIMIT = 100;

export class GitHubCliAdapter implements IssueAdapter {
  constructor(private cwd: string) {}

  fetchIssue(issueNumber: number): StandardIssue {
    const issue = ghFetchAndParse(
      ['issue', 'view', String(issueNumber), '--json', 'number,title,body,labels,state'],
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
    };
  }

  fetchOpenIssues(limit: number = DEFAULT_ISSUE_LIMIT): StandardIssueListItem[] {
    const issues = ghFetchAndParse(
      [
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
    }));
  }
}
