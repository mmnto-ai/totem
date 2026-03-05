import { execFileSync } from 'node:child_process';

import { z } from 'zod';

import { GH_TIMEOUT_MS, IS_WIN } from '../utils.js';
import type { IssueAdapter, StandardIssue, StandardIssueListItem } from './issue-adapter.js';

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

// ─── Shared error handling ──────────────────────────────

function handleGhError(err: unknown, context: string): never {
  if (err instanceof z.ZodError) {
    throw new Error(`[Totem Error] Failed to parse GitHub ${context}: ${err.message}`);
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('ENOENT') || msg.includes('not found')) {
    throw new Error(
      `[Totem Error] GitHub CLI (gh) is required for issue fetching. Install: https://cli.github.com`,
    );
  }
  throw new Error(`[Totem Error] Failed to fetch ${context}: ${msg}`);
}

// ─── Adapter implementation ─────────────────────────────

const DEFAULT_ISSUE_LIMIT = 100;

export class GitHubCliAdapter implements IssueAdapter {
  constructor(private cwd: string) {}

  fetchIssue(issueNumber: number): StandardIssue {
    try {
      const raw = execFileSync(
        'gh',
        ['issue', 'view', String(issueNumber), '--json', 'number,title,body,labels,state'],
        { cwd: this.cwd, encoding: 'utf-8', timeout: GH_TIMEOUT_MS, shell: IS_WIN },
      );

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(
          `[Totem Error] GitHub CLI returned invalid JSON for issue #${issueNumber}. Are you authenticated?`,
        );
      }

      const issue = GhIssueSchema.parse(parsed);
      return {
        number: issue.number,
        title: issue.title,
        body: issue.body ?? '',
        state: issue.state,
        labels: issue.labels.map((l) => l.name),
      };
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes('[Totem Error]') || err.message.includes('invalid JSON'))
      ) {
        throw err;
      }
      handleGhError(err, `issue #${issueNumber}`);
    }
  }

  fetchOpenIssues(limit: number = DEFAULT_ISSUE_LIMIT): StandardIssueListItem[] {
    try {
      const raw = execFileSync(
        'gh',
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
        { cwd: this.cwd, encoding: 'utf-8', timeout: GH_TIMEOUT_MS, shell: IS_WIN },
      );

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(
          `[Totem Error] GitHub CLI returned invalid JSON for issue list. Are you authenticated?`,
        );
      }

      const issues = z.array(GhIssueListItemSchema).parse(parsed);
      return issues.map((i) => ({
        number: i.number,
        title: i.title,
        labels: i.labels.map((l) => l.name),
        updatedAt: i.updatedAt,
      }));
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes('[Totem Error]') || err.message.includes('invalid JSON'))
      ) {
        throw err;
      }
      handleGhError(err, 'open issues');
    }
  }
}
